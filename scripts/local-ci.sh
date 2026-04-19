#!/bin/bash
#!/bin/bash

# Local CI - runs tests asynchronously on new commits
# Usage:
#   ./scripts/local-ci.sh                           # Show usage
#   ./scripts/local-ci.sh watch                     # Watch mode: test HEAD when it changes
#   ./scripts/local-ci.sh <hash>                    # Test specific commit once
#   ./scripts/local-ci.sh <hash> --screenshots <branch>  # Force screenshots for given branch

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CI_DIR="$PROJECT_ROOT/.ci"
QUEUE_FILE="$CI_DIR/queue.json"
TESTED_FILE="$CI_DIR/tested.json"
LOG_FILE="$CI_DIR/test-results.log"
WORKTREE_BASE="$CI_DIR/worktrees"
IN_PROGRESS_FILE="$CI_DIR/in_progress.json"

POLL_INTERVAL=30
MAX_QUEUE=20
TEST_PORT=18081  # Use different port to avoid conflicts with manual tests

# Handle command line arguments
MODE=""
COMMIT_REQUEST=""
FORCE_SCREENSHOTS=""
FORCE_BRANCH=""
STOP_REQUESTED=0

if [ $# -eq 0 ]; then
    echo "Usage:"
    echo "  ./scripts/local-ci.sh watch               # Watch mode: test HEAD when it changes"
    echo "  ./scripts/local-ci.sh <hash>              # Test specific commit once"
    echo "  ./scripts/local-ci.sh <hash> --screenshots <branch> # Force screenshots for given branch"
    exit 0
elif [ "$1" = "watch" ]; then
    MODE="watch"
else
    MODE="once"
    COMMIT_REQUEST="$1"
    # Check for --screenshots flag with branch name
    if [ "$2" = "--screenshots" ] && [ -n "$3" ]; then
        FORCE_SCREENSHOTS=1
        FORCE_BRANCH="$3"
    fi
fi

# Validate commit if provided
if [ -n "$COMMIT_REQUEST" ]; then
    if git -C "$PROJECT_ROOT" rev-parse "$COMMIT_REQUEST" >/dev/null 2>&1; then
        echo "$COMMIT_REQUEST" > "$CI_DIR/test-commit"
    else
        echo "Error: Invalid commit hash: $COMMIT_REQUEST"
        exit 1
    fi
fi

mkdir -p "$CI_DIR"
mkdir -p "$WORKTREE_BASE"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log_stderr() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2
}

notify() {
    # Use osascript alert for persistent notification
    osascript -e 'tell app "System Events" to display dialog "'"$1"'" with title "HFS CI" buttons {"OK"} default button 1 giving up after 0'
}

is_interrupted_exit_code() {
    local exit_code="$1"
    [ "$exit_code" -eq 130 ] || [ "$exit_code" -eq 143 ]
}

on_stop_signal() {
    local signal_name="$1"

    if [ "$STOP_REQUESTED" -eq 1 ]; then
        exit 130
    fi

    STOP_REQUESTED=1
    log_stderr "Received $signal_name, stopping local-ci"
    clear_in_progress

    # kill children to avoid leaving test/build processes alive after ctrl+c
    pkill -TERM -P $$ >/dev/null 2>&1 || true
    sleep 0.2
    pkill -KILL -P $$ >/dev/null 2>&1 || true
    exit 130
}

get_current_branch() {
    local branch
    branch=$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || true)
    if [ -n "$branch" ]; then
        echo "$branch"
        return
    fi

    # detached HEAD can still belong to a local branch
    branch=$(git -C "$PROJECT_ROOT" for-each-ref --format='%(refname:short)' --contains HEAD refs/heads 2>/dev/null | head -n 1)
    if [ -n "$branch" ]; then
        echo "$branch"
        return
    fi

    echo "detached"
}

get_recent_commits() {
    local branch="$1"
    git -C "$PROJECT_ROOT" rev-list --max-count=50 "$branch"
}

load_queue() {
    if [ -f "$QUEUE_FILE" ] && [ -s "$QUEUE_FILE" ]; then
        if jq -e . "$QUEUE_FILE" >/dev/null 2>&1; then
            cat "$QUEUE_FILE"
        else
            # previous local-ci versions could accidentally mix log lines with JSON; recover automatically to keep watch mode running
            log_stderr "Invalid queue file, resetting to empty queue"
            echo "[]"
        fi
    else
        echo "[]"
    fi
}

save_queue() {
    echo "$1" > "$QUEUE_FILE"
}

load_tested() {
    if [ -f "$TESTED_FILE" ] && [ -s "$TESTED_FILE" ]; then
        if jq -e . "$TESTED_FILE" >/dev/null 2>&1; then
            cat "$TESTED_FILE"
        else
            log_stderr "Invalid tested file, resetting tested history"
            echo "[]"
        fi
    else
        echo "[]"
    fi
}

save_tested() {
    echo "$1" > "$TESTED_FILE"
}

is_tested() {
    local commit="$1"
    local tested="$2"
    echo "$tested" | grep -q "\"$commit\""
}

add_to_tested() {
    local commit="$1"
    local tested="$2"
    local branch="$3"
    
    # Remove this commit from tested list (we'll re-add it with fresh timestamp)
    local new_tested
    new_tested=$(echo "$tested" | jq --arg commit "$commit" --arg branch "$branch" \
        'map(select(.commit != $commit)) + [{"commit": $commit, "branch": $branch, "timestamp": (now | todate)}]')
    
    echo "$new_tested"
}

save_in_progress() {
    local commit="$1"
    local branch="$2"
    echo '{"commit": "'"$commit"'", "branch": "'"$branch"'"}' > "$IN_PROGRESS_FILE"
}

clear_in_progress() {
    rm -f "$IN_PROGRESS_FILE"
}

load_in_progress() {
    if [ -f "$IN_PROGRESS_FILE" ] && [ -s "$IN_PROGRESS_FILE" ]; then
        cat "$IN_PROGRESS_FILE"
    else
        echo "null"
    fi
}

queue_contains() {
    local commit="$1"
    local queue="$2"
    echo "$queue" | grep -q "\"$commit\""
}

add_to_queue() {
    local queue="$1"
    local commit="$2"
    local branch="$3"
    
    local new_queue
    new_queue=$(echo "$queue" | jq --arg commit "$commit" --arg branch "$branch" \
        '. + [{"commit": $commit, "branch": $branch, "added_at": (now | todate)}]')
    
    echo "$new_queue"
}

is_commit_reachable_from_head() {
    local commit="$1"
    local head="$2"
    git -C "$PROJECT_ROOT" merge-base --is-ancestor "$commit" "$head" >/dev/null 2>&1
}

prune_queue_for_head() {
    local queue="$1"
    local head="$2"
    local pruned_queue='[]'
    local commit=""
    local branch=""
    local added_at=""

    while IFS=$'\t' read -r commit branch added_at; do
        if [ -z "$commit" ]; then
            continue
        fi
        if ! is_commit_reachable_from_head "$commit" "$head"; then
            log_stderr "Dropping stale queued commit $commit (not reachable from current HEAD)"
            continue
        fi
        if queue_contains "$commit" "$pruned_queue"; then
            # queue duplication is expected after interrupted runs, so keep only one entry per commit to avoid retesting the same hash
            continue
        fi
        pruned_queue=$(add_to_queue "$pruned_queue" "$commit" "$branch")
    done < <(echo "$queue" | jq -r '.[] | [.commit, .branch, .added_at] | @tsv')

    echo "$pruned_queue"
}

remove_from_queue() {
    local queue="$1"
    local commit="$2"
    
    local new_queue
    new_queue=$(echo "$queue" | jq --arg commit "$commit" \
        '. = [.[] | select(.commit != $commit)]')
    
    echo "$new_queue"
}

# Strip ANSI escape codes from output
strip_ansi() {
    # playwright/vite emit cursor-control escapes and occasional NUL bytes; strip both so the saved log stays plain text
    perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/\x00//g'
}

count_log_lines() {
    if [ -f "$LOG_FILE" ]; then
        wc -l < "$LOG_FILE"
    else
        echo "0"
    fi
}

log_failure_summary() {
    local from_line="$1"
    local stage_name="$2"
    local summary

    # this log can contain NUL bytes from osascript output, so force text mode and keep only lines that identify the failing test
    summary=$(tail -n "+$((from_line + 1))" "$LOG_FILE" \
        | grep -aE "not ok [0-9]+ - |error: |failureType: |location: |# fail [0-9]+" \
        | tail -n 12)

    if [ -z "$summary" ]; then
        return
    fi

    log "$stage_name failure summary (last relevant lines):"
    while IFS= read -r line; do
        log "  $line"
    done <<< "$summary"
}

run_test() {
    local commit="$1"
    local branch="$2"
    local worktree_path="$WORKTREE_BASE/$commit"
    local tip=""
    
    log "Starting test for $commit (branch: $branch)"
    
    # Remove existing worktree if any
    if [ -d "$worktree_path" ]; then
        rm -rf "$worktree_path"
    fi
    
    # Create worktree
    git -C "$PROJECT_ROOT" worktree add "$worktree_path" "$commit"
    
    if [ -n "$branch" ] && [ "$branch" != "detached" ]; then
        tip=$(git -C "$PROJECT_ROOT" rev-parse "$branch" 2>/dev/null || echo "")
    fi

    # Modify port in worktree to avoid conflicts for detached or non-tip commits
    if [ -z "$branch" ] || [ "$branch" = "detached" ] || [ "$commit" != "$tip" ]; then
        log "Changing tests/config.yaml port to $TEST_PORT in worktree files"
        sed -i '' -E "s/^port:[[:space:]]*[0-9]+/port: $TEST_PORT/" "$worktree_path/tests/config.yaml" 2>/dev/null || true
        # older commits can still hardcode 8081 in e2e files, so keep this fallback for compatibility
        sed -i '' "s/8081/$TEST_PORT/g" "$worktree_path/e2e/common.ts" 2>/dev/null || true
        sed -i '' "s/8081/$TEST_PORT/g" "$worktree_path/playwright.config.ts" 2>/dev/null || true
    fi
    
    local exit_code=0
    local log_start=0
    
    # Build includes backend tests already, so running test-with-server again here would duplicate the suite and add flaky noise
    log_start=$(count_log_lines)
    cd "$worktree_path" && env -u NO_COLOR FORCE_COLOR=1 npm run build-all 2>&1 | tee >(strip_ansi >> "$LOG_FILE")
    build_result=${PIPESTATUS[0]}
    if is_interrupted_exit_code "$build_result"; then
        log "BUILD-ALL interrupted for $commit with exit code $build_result"
        exit_code="$build_result"
    elif [ $build_result -ne 0 ]; then
        log "BUILD-ALL FAILED for $commit with exit code $build_result"
        log_failure_summary "$log_start" "BUILD-ALL"
        exit_code=1
    fi
    
    if [ $exit_code -eq 0 ]; then
        # Check if this commit is the tip of the branch or if forced
        local can_use_screenshots=0
        local screenshot_branch="$branch"
        
        if [ -n "$FORCE_BRANCH" ]; then
            can_use_screenshots=1
            screenshot_branch="$FORCE_BRANCH"
            log "Forcing screenshots with branch $FORCE_BRANCH for commit $commit"
        elif [ -n "$branch" ] && [ "$branch" != "detached" ]; then
            if [ "$commit" = "$tip" ]; then
                can_use_screenshots=1
            fi
        fi
        
        if [ $can_use_screenshots -eq 1 ]; then
            # Enable screenshots by creating symlink to snapshots
            local snapshot_dir="$worktree_path/e2e/frontend.spec.ts-snapshots-${screenshot_branch}"
            mkdir -p "$(dirname "$snapshot_dir")"
            if [ -d "$PROJECT_ROOT/e2e/frontend.spec.ts-snapshots-${screenshot_branch}" ]; then
                ln -sf "$PROJECT_ROOT/e2e/frontend.spec.ts-snapshots-${screenshot_branch}" "$snapshot_dir"
                log "Screenshots enabled for commit $commit (branch: $screenshot_branch)"
            fi
            # Pass branch name to Playwright so it uses correct snapshot folder
            log_start=$(count_log_lines)
            cd "$worktree_path" && {
                env -u NO_COLOR PLAYWRIGHT_SNAPSHOT_BRANCH="$screenshot_branch" FORCE_COLOR=1 npx playwright test frontend --reporter=line &&
                env -u NO_COLOR PLAYWRIGHT_SNAPSHOT_BRANCH="$screenshot_branch" FORCE_COLOR=1 npx playwright test serial --reporter=line
            } 2>&1 | tee >(strip_ansi >> "$LOG_FILE")
            test_ui_result=${PIPESTATUS[0]}
            if is_interrupted_exit_code "$test_ui_result"; then
                log "TEST-UI interrupted for $commit with exit code $test_ui_result"
                exit_code="$test_ui_result"
            elif [ $test_ui_result -ne 0 ]; then
                log "TEST-UI FAILED for $commit with exit code $test_ui_result"
                log_failure_summary "$log_start" "TEST-UI"
                exit_code=3
            fi
        else
            # non-tip/detached commits cannot rely on branch snapshot folders
            log "Running test-ui with screenshots disabled for non-tip/detached commit $commit"
            log_start=$(count_log_lines)
            cd "$worktree_path" && {
                env -u NO_COLOR NO_SS=1 FORCE_COLOR=1 npx playwright test frontend --ignore-snapshots --reporter=line &&
                env -u NO_COLOR NO_SS=1 FORCE_COLOR=1 npx playwright test serial --ignore-snapshots --reporter=line
            } 2>&1 | tee >(strip_ansi >> "$LOG_FILE")
            test_ui_result=${PIPESTATUS[0]}
            if is_interrupted_exit_code "$test_ui_result"; then
                log "TEST-UI interrupted for $commit with exit code $test_ui_result"
                exit_code="$test_ui_result"
            elif [ $test_ui_result -ne 0 ]; then
                log "TEST-UI FAILED for $commit with exit code $test_ui_result"
                log_failure_summary "$log_start" "TEST-UI"
                exit_code=3
            fi
        fi
    fi
    
    # keep detached failing worktree for investigation, but don't keep it when interrupted manually
    if [ $exit_code -ne 0 ] && ! is_interrupted_exit_code "$exit_code" && ( [ -z "$branch" ] || [ "$branch" = "detached" ] ); then
        log "Test FAILED on detached HEAD. Worktree kept for investigation at: $worktree_path"
        log "To clean up manually: git worktree remove --force $worktree_path"
    else
        git -C "$PROJECT_ROOT" worktree remove "$worktree_path" --force 2>/dev/null || true
    fi
    
    log "Test for $commit completed with exit code $exit_code"
    
    return $exit_code
}

# Main loop
trap 'on_stop_signal SIGINT' INT
trap 'on_stop_signal SIGTERM' TERM

log "Local CI started"

# Load state from files (survives restarts)
tested_commits=$(load_tested)
queue=$(load_queue)
current_branch=$(get_current_branch)
head_commit=$(git -C "$PROJECT_ROOT" rev-parse HEAD)

# after rebases, persisted queue entries can point to obsolete history and must be dropped to keep watch mode aligned with current HEAD
queue=$(prune_queue_for_head "$queue" "$head_commit")
save_queue "$queue"

# Check for interrupted test
in_progress=$(load_in_progress)
if [ "$in_progress" != "null" ]; then
    commit=$(echo "$in_progress" | jq -r '.commit')
    branch=$(echo "$in_progress" | jq -r '.branch')
    if is_commit_reachable_from_head "$commit" "$head_commit"; then
        if ! queue_contains "$commit" "$queue"; then
            log "Found interrupted test for $commit, re-queuing"
            queue=$(add_to_queue "$queue" "$commit" "$branch")
            save_queue "$queue"
        fi
    else
        log "Dropping stale interrupted commit $commit (not reachable from current HEAD)"
    fi
    clear_in_progress
fi

# explicit once mode should test only the requested commit and ignore persisted queue state
if [ "$MODE" = "once" ]; then
    if [ "$(echo "$queue" | jq 'length')" -gt 0 ]; then
        log "Once mode: ignoring persisted queue and testing only requested commit"
    fi
    queue='[]'
    save_queue "$queue"
    clear_in_progress
fi

log "Loaded tested: $(echo "$tested_commits" | jq 'length') commits"
log "Loaded queue: $(echo "$queue" | jq 'length') commits"

# Clean up stale worktrees from previous interrupted runs
for worktree in "$WORKTREE_BASE"/*; do
    if [ -d "$worktree" ]; then
        commit=$(basename "$worktree")
        log "Cleaning up stale worktree for $commit"
        git -C "$PROJECT_ROOT" worktree remove "$worktree" --force 2>/dev/null || true
    fi
done

while true; do
    # Load state
    queue=$(load_queue)
    
    # Check for manual commit request
    if [ -f "$CI_DIR/test-commit" ]; then
        requested_commit=$(cat "$CI_DIR/test-commit" | tr -d ' \n')
        if [ -n "$requested_commit" ]; then
            if [ "$requested_commit" = "HEAD" ]; then
                # Use current HEAD
                requested_commit=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
                requested_branch=$(get_current_branch)
            else
                # Verify it's a valid commit
                if git -C "$PROJECT_ROOT" rev-parse "$requested_commit" >/dev/null 2>&1; then
                    requested_branch=$(git -C "$PROJECT_ROOT" for-each-ref --format='%(refname:short)' --contains "$requested_commit" refs/heads 2>/dev/null | head -n 1)
                    requested_branch=${requested_branch:-detached}
                else
                    log "Invalid commit hash: $requested_commit"
                    rm -f "$CI_DIR/test-commit"
                    requested_commit=""
                fi
            fi
            
            if [ -n "$requested_commit" ] && ( [ "$MODE" = "once" ] || ( ! is_tested "$requested_commit" "$tested_commits" && ! queue_contains "$requested_commit" "$queue" ) ); then
                queue=$(add_to_queue "$queue" "$requested_commit" "$requested_branch")
                log "Added requested commit $requested_commit to queue"
                rm -f "$CI_DIR/test-commit"
            fi
        fi
    fi
    
    # Find new commits to test - only HEAD
    current_branch=$(get_current_branch)
    
    # Get HEAD commit only
    head_commit=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
    
    # Check if HEAD is not yet tested and not in queue
    if ! is_tested "$head_commit" "$tested_commits" && ! queue_contains "$head_commit" "$queue"; then
        queue_size=$(echo "$queue" | jq 'length')
        if [ "$queue_size" -lt $MAX_QUEUE ]; then
            queue=$(add_to_queue "$queue" "$head_commit" "$current_branch")
            log "Added HEAD commit $head_commit to queue"
        else
            log "Queue full ($queue_size/$MAX_QUEUE), waiting..."
        fi
    fi
    
    save_queue "$queue"
    
    # Get queue and start test if available
    queue=$(load_queue)
    queue_size=$(echo "$queue" | jq 'length')
    
    if [ "$queue_size" -gt 0 ]; then
        # Get first item from queue
        item=$(echo "$queue" | jq -r '.[0]')
        commit=$(echo "$item" | jq -r '.commit')
        branch=$(echo "$item" | jq -r '.branch')
        
        log "Testing commit $commit from queue (remaining: $((queue_size - 1)))"
        
        # Save in-progress state (survives restarts)
        save_in_progress "$commit" "$branch"
        
        # Run test
        if run_test "$commit" "$branch"; then
            # Test passed - add to tested list
            tested_commits=$(add_to_tested "$commit" "$tested_commits" "$branch")
            save_tested "$tested_commits"
            log "TEST PASSED for $commit"
            
            # Clear in-progress state and remove from queue
            clear_in_progress
            queue=$(load_queue)
            queue=$(remove_from_queue "$queue" "$commit")
            save_queue "$queue"
            
            # If running in "once" mode, exit after test completes
            if [ "$MODE" = "once" ]; then
                log "Test completed in once mode, exiting."
                exit 0
            fi
        else
            exit_code=$?
            if is_interrupted_exit_code "$exit_code"; then
                log "TEST INTERRUPTED for $commit - STOPPING CI"
                clear_in_progress
                exit "$exit_code"
            else
                # Failed - notify and stop
                log "TEST FAILED for $commit - STOPPING CI"
                notify "HFS CI: Test FAILED for ${commit:0:7}. CI STOPPED."
                clear_in_progress
                
                # Remove from queue
                queue=$(load_queue)
                queue=$(remove_from_queue "$queue" "$commit")
                save_queue "$queue"
                
                log "CI stopped due to test failure. Run 'npm run local-ci' to restart."
                exit 1
            fi
        fi
    fi
    
    sleep $POLL_INTERVAL
done

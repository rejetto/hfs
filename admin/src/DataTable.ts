import { DataGrid, DataGridProps, getGridStringOperators, GridColDef, GridFilterForm, GridFilterItem, GridFilterModel,
    GridFooter, GridFooterContainer, gridClasses, GridLogicOperator, GridPanelContent, GridPanelFooter, GridPanelWrapper,
    GridValidRowModel, useGridApiContext, useGridApiRef, GridRenderCellParams, QuickFilter, QuickFilterControl,
    useGridRootProps } from '@mui/x-data-grid'
import { enUS } from '@mui/x-data-grid/locales'
import { GridColumnHeaderFilterIconButton, type ColumnHeaderFilterIconButtonProps } from '@mui/x-data-grid/components'
import { Alert, Box, BoxProps, Chip, LinearProgress, useTheme } from '@mui/material'
import type { Breakpoint } from '@mui/material/styles'
import { createElement as h, type ElementType, Fragment, ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callable, Callback, Falsy, newDialog, objFromKeys, onlyTruthy, useGetSize } from '@hfs/shared'
import _ from 'lodash'
import { Center, Flex, IconBtn, mergeSx } from './mui'
import { Close, Delete, FilterAlt, Save, Search } from '@mui/icons-material'
import { promptDialog } from './dialog'
import { SxProps } from '@mui/system'
import { state, updateStateObject } from './state'
import { useDebounce } from 'usehooks-ts'
import { applyMultiFilter, countActiveMultiFilters } from './multiFilter'

const ACTIONS = 'Actions'

export type DataTableColumn<R extends GridValidRowModel=any> = GridColDef<R> & {
    hideUnder?: Breakpoint | number | boolean
    dialogHidden?: boolean
    sx?: SxProps | Callback<GridRenderCellParams, SxProps>
    mergeRender?: { [other: string]: false | { override?: Partial<GridColDef<R>> } & BoxProps }
    mergeRenderSx?: SxProps
    cellInnerProps?: BoxProps
}
export interface DataTableProps<R extends GridValidRowModel=any> extends Omit<DataGridProps<R>, 'columns'> {
    columns: Array<DataTableColumn<R> | Falsy>
    actions?: ({ row, id }: any) => ReactNode[]
    actionsHeader?: ReactNode | Callback<any, ReactNode>
    quickFilter?: boolean
    actionsProps?: Partial<GridColDef<R>> & { hideUnder?: Breakpoint | number }
    initializing?: boolean
    noRows?: ReactNode
    error?: ReactNode
    compact?: boolean
    footerSide?: (width: number) => ReactNode
    fillFlex?: boolean
    persist?: string
    details?: boolean
}
export function DataTable({
    columns, initialState={}, actions, actionsHeader, actionsProps, initializing, noRows, error, compact, footerSide, fillFlex,
    persist, details, quickFilter, slots, slotProps, filterModel, onFilterModelChange, ...rest
}: DataTableProps) {
    const theme = useTheme()
    const apiRef = useGridApiRef()
    const [localMultiFilterModel, setLocalMultiFilterModel] = useState<GridFilterModel>(() =>
        filterModel || initialState.filter?.filterModel || { items: [], logicOperator: GridLogicOperator.And })
    const multiFilterModel = filterModel || localMultiFilterModel
    const [gridReady, setGridReady] = useState(false)
    useEffect(() => {
        // filter operators need the grid API, which is populated only after DataGrid mounts
        setGridReady(true)
    }, [])
    const [actionsLength, setActionsLength] = useState(0)
    const [quickFilterOpen, setQuickFilterOpen] = useState(false)
    const [merged, setMerged] = useState(0)
    const manipulatedColumns = useMemo(() => {
        const { localeText } = enUS.components.MuiDataGrid.defaultProps as any
        const ret = onlyTruthy(columns.map(col => {
            if (!col) return
            const { type, sx } = col
            if (!type || type === 'string') // offer negated version of default string operators
                col.filterOperators ??= getGridStringOperators().flatMap(op => op.value.includes('Empty') ? op : [ // isEmpty already has isNotEmpty
                    op,
                    {
                        ...op,
                        value: '!' + op.value,
                        getApplyFilterFn(item, col) {
                            const res = op.getApplyFilterFn(item, col)
                            return res && _.negate(res)
                        },
                        label: "(not) " + (localeText['filterOperator' + _.upperFirst(op.value)] || op.value)
                    } satisfies typeof op
                ])
            if (!col.mergeRender && !col.sx)
                return col
            return {
                ...col,
                originalRenderCell: col.renderCell || true,
                renderCell(params: GridRenderCellParams) {
                    const { columns } = params.api.store.getSnapshot()
                    return h(Box, { ...col.cellInnerProps, sx: { maxHeight: '100%', textWrap: 'wrap', lineHeight: '1.2em', ...callable(sx as any, params) } }, // wrap if necessary, but stay within the row
                        col.renderCell ? col.renderCell(params) : params.formattedValue,
                        col.mergeRender && h(Flex, { fontSize: 'smaller', flexWrap: 'wrap', mt: '1px', rowGap: 0, ...col.mergeRenderSx }, // wrap, normally causing overflow/hiding, if it doesn't fit
                            ...onlyTruthy(_.map(col.mergeRender, (props, other) => {
                                if (!props || columns.columnVisibilityModel[other] !== false) return null
                                const rendered = renderCell({ ...columns.lookup[other], ...props.override }, params.row)
                                // keep mergeRender permissive for editor autocomplete, then narrow only at the render boundary
                                const { override, sx, ...boxProps } = props
                                return rendered && h(Box as any, { ...boxProps, sx: mergeSx(sx, compact && { lineHeight: '1em' }) }, rendered)
                            }))
                        )
                    )
                }
            }
        }))
        if (actions)
            ret.unshift({
                field: ACTIONS,
                width: 40 * actionsLength,
                headerName: '',
                align: 'center',
                headerAlign: 'center',
                sortable: false,
                hideSortIcons: true,
                disableColumnMenu: true,
                renderCell(params: any) {
                    const ret = actions({ ...params.row, ...params })
                    setTimeout(() => setActionsLength(ret.length)) // cannot update state during rendering
                    return h(Box, { sx: { whiteSpace: 'nowrap' } }, ...ret)
                },
                ...actionsProps,
                filterable: false,
                renderHeader: quickFilter || actionsHeader ? renderActionsHeader : actionsProps?.renderHeader,
            })
        return ret
    }, [columns, actions, actionsHeader, actionsLength, actionsProps, quickFilter])
    const sizeGrid = useGetSize()
    const width = useDebounce(sizeGrid.w || 0, 100) // stabilize width
    const hideCols = useMemo(() => {
        const fields = onlyTruthy(manipulatedColumns.map(({ field, hideUnder }) =>
            (hideUnder === true || hideUnder && width < (typeof hideUnder === 'number' ? hideUnder : theme.breakpoints.values[hideUnder]))
            && field))
        const o = Object.fromEntries(fields.map(x => [x, false]))
        _.merge(initialState, { columns: { columnVisibilityModel: o } })
        if (quickFilter)
            _.merge(initialState, { filter: { filterModel: { quickFilterExcludeHiddenColumns: false } } })
        // count the hidden columns that are merged into visible columns
        setMerged(_.sumBy(fields, k => _.find(columns, col => col && !fields.includes(col.field) && col.mergeRender?.[k]) ? 1 : 0))
        return fields
    }, [manipulatedColumns, width, quickFilter])
    const [vis, setVis] = useState(persist && state.dataTablePersistence[persist]?.columnVisibility || {})
    const [filterPresets, setFilterPresetsState] = useState<FilterPresets>(() =>
        _.cloneDeep(persist && state.dataTablePersistence[persist]?.filterPresets || {}))
    const automaticColumnVisibility = useMemo(() => ({
        ...objFromKeys(hideCols, () => false),
        ...rest.columnVisibilityModel,
    }), [hideCols, rest.columnVisibilityModel])
    useEffect(() => {
        if (!persist || !apiRef.current) return
        // MUI replaces its reset baseline when columns change, so keep it anchored to automatic visibility
        apiRef.current.setState(was => ({
            ...was,
            columns: {
                ...was.columns,
                initialColumnVisibilityModel: automaticColumnVisibility,
            },
        }))
    }, [persist, automaticColumnVisibility])

    const displayingDetails = useRef<any>({})
    useEffect(() => {
        const { current: { id, setCurRow } } = displayingDetails
        setCurRow?.(_.find(rest.rows, { id }))
    })
    const sizeFooterSide = useGetSize()
    const wrappedFooterSide = h(Flex, {
        ref: sizeFooterSide.refToPass,
        className: 'footerSide',
        gap: 0,
    },
        footerSide?.(width),
        !rest.disableColumnFilter && h(IconBtn, { icon: FilterAlt, title: "Filters", size: 'small', onClick: () => apiRef.current?.showFilterPanel() }),
    )
    const [causingScrolling, setCausingScrolling] = useState(false)
    const updateCausingScrolling = useCallback(_.debounce(() => {
        const el = sizeGrid.ref.current?.querySelector('.MuiTablePagination-root')
        setCausingScrolling(el && (el.scrollWidth > el.clientWidth) || false)
    }, 500), [sizeGrid])
    useEffect(updateCausingScrolling, [sizeGrid, width, sizeFooterSide.w]) // recalculate in case the footerSide changes
    // keep the multi-filter model outside DataGrid because the Community edition truncates it to one item
    const filteredRows = useMemo(() =>
        gridReady ? applyMultiFilter(rest.rows || [], multiFilterModel, apiRef) : rest.rows,
    // rerun when columns change because filter operators are read from the processed grid columns
    [gridReady, rest.rows, manipulatedColumns, multiFilterModel, apiRef])
    const gridInitialState = {
        ...initialState,
        filter: {
            ...initialState.filter,
            filterModel: { ...initialState.filter?.filterModel, items: [] },
        },
    }
    const effectiveSlotProps = {
        ...slotProps,
        columnHeaderFilterIconButton: {
            ...(slotProps as any)?.columnHeaderFilterIconButton,
            multiFilterModel,
        },
        columnMenu: {
            ...(slotProps as any)?.columnMenu,
            slots: {
                ...(slotProps as any)?.columnMenu?.slots,
                columnMenuFilterItem: MultiFilterMenuItem,
            },
            slotProps: {
                ...(slotProps as any)?.columnMenu?.slotProps,
                columnMenuFilterItem: {
                    ...(slotProps as any)?.columnMenu?.slotProps?.columnMenuFilterItem,
                    onOpenMultiFilter: openMultiFilter,
                },
            },
        },
        filterPanel: {
            ...(slotProps as any)?.filterPanel,
            model: multiFilterModel,
            onChange: changeMultiFilterModel,
            ...persist && {
                presets: filterPresets,
                onSavePreset: saveFilterPreset,
                onLoadPreset: loadFilterPreset,
                onDeletePreset: deleteFilterPreset,
            },
        },
    }

    return h(Fragment, {},
        error && h(Alert, { severity: 'error' }, error),
        initializing && h(Box, { sx: { position: 'relative' } },
            h(LinearProgress, { // differently from "loading", this is not blocking user interaction
                sx: { position: 'absolute', width: 'calc(100% - 2px)', borderRadius: 1, m: '1px 1px' }
            }) ),
        h(DataGrid, {
            key: width,
            initialState: gridInitialState,
            density: compact ? 'compact' : 'standard',
            columns: manipulatedColumns,
            apiRef,
            disableRowSelectionOnClick: true,
            ref: sizeGrid.refToPass,
            ...rest,
            rows: filteredRows,
            ...quickFilter && { showToolbar: quickFilterOpen || rest.showToolbar },
            sx: mergeSx({
                ...fillFlex && { height: 0, flex: 'auto' }, // limit table to available screen space, if parent is flex. Consider using fillFlexParentSx
                '& .MuiDataGrid-virtualScroller': { minHeight: '3em' }, // without this, no-entries gets just 1px
                '& .MuiTablePagination-root': { scrollbarWidth: 'none'},
            }, rest.sx),
            slots: {
                footer: CustomFooter,
                noRowsOverlay: NoRowsOverlay,
                filterPanel: MultiFilterPanel,
                filterPanelDeleteIcon: Delete,
                columnHeaderFilterIconButton: MultiFilterHeaderIconButton,
                ...slots,
                ...quickFilterOpen && { toolbar: DataTableQuickFilterToolbar as any }
            } as any,
            slotProps: {
                ...effectiveSlotProps,
                ...quickFilterOpen && { toolbar: { ...(effectiveSlotProps as any)?.toolbar, onExpandedChange: setQuickFilterOpen } },
                footer: { ...(effectiveSlotProps as any)?.footer, add: wrappedFooterSide },
                noRowsOverlay: { ...(effectiveSlotProps as any)?.noRowsOverlay, initializing, noRows },
                pagination: {
                    labelRowsPerPage: "Rows",
                    ...!causingScrolling && {
                        showFirstButton: true,
                        showLastButton: true,
                    },
                    ...(effectiveSlotProps as any)?.pagination,
                },
            },
            onCellClick({ field, row }) {
                if (field === ACTIONS || details === false) return
                if (window.getSelection()?.type === 'Range') return // not a click but a drag
                const visibleInList = merged + (apiRef.current?.getVisibleColumns().length || 0)
                const showInDialog = manipulatedColumns.filter(x =>
                    !x.dialogHidden && (x.renderCell || x.valueGetter || x.field === ACTIONS || row[x.field] !== undefined))
                if (showInDialog.length <= visibleInList) return // no need for dialog
                newDialog({
                    title: "Details",
                    onClose() {
                        displayingDetails.current = {}
                    },
                    Content() {
                        const [curRow, setCurRow] = useState(row)
                        const keepRow = useRef(row)
                        if (curRow)
                            keepRow.current = curRow
                        const rowToShow = keepRow.current
                        displayingDetails.current = { id: rowToShow.id, setCurRow }
                        return h(Box, {
                            sx: {
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(8em,1fr))',
                                gap: '1em',
                                gridAutoFlow: 'dense',
                                minWidth: 'max(16em, 40vw)',
                                opacity: curRow ? undefined : .5,
                            },
                        }, showInDialog.map(col =>
                            h(Box, { key: col.field, sx: { gridColumn: col.flex! >= 1 ? '1/-1' : undefined } },
                                h(Box, { sx: { bgcolor: '#0003', p: 1 } }, col.headerName || col.field),
                                h(Flex, { minHeight: '2.5em', px: 1, wordBreak: 'break-word', flexWrap: 'wrap' },
                                    renderCell(col, rowToShow) )
                            ) ))
                    }
                })
            },
            onColumnVisibilityModelChange: vis => {
                const reset = persist && _.isEqual(vis, apiRef.current?.store.getSnapshot().columns.initialColumnVisibilityModel)
                if (reset) { // reset restores the persisted mount state, so discard it to restore automatic visibility
                    setVis({})
                    updateStateObject(state, 'dataTablePersistence', x => {
                        // column reset must not discard independently persisted filter presets
                        const tablePersistence = x[persist]
                        if (!tablePersistence) return
                        delete tablePersistence.columnVisibility
                        if (_.isEmpty(tablePersistence))
                            delete x[persist]
                    })
                    return
                }
                setVis(vis)
                if (!persist) return
                updateStateObject(state, 'dataTablePersistence', x => {
                    x[persist] = {
                        ...x[persist],
                        columnVisibility: _.omitBy(vis, (v, k) => hideCols.includes(k) === (v === false))
                    }
                })
            },
            columnVisibilityModel: {
                ...automaticColumnVisibility,
                ...vis,
            }
        })
    )

    function renderActionsHeader(params: any) {
        return h(Box, { sx: { display: 'flex', width: '100%', justifyContent: 'center' }, onClick: stopPropagation, onKeyDown: stopPropagation },
            actionsHeader !== undefined ? callable(actionsHeader, params) : actionsProps?.renderHeader?.(params),
            quickFilter && h(IconBtn, { icon: Search, title: "Search", size: 'small', onClick: () => setQuickFilterOpen(true) }))

        function stopPropagation(ev: SyntheticEvent) {
            // prevent header controls from triggering grid sorting or column interactions
            ev.stopPropagation()
        }
    }

    function openMultiFilter(column: GridColDef) {
        if (multiFilterModel.items.some(({ field }) => field === column.field)) return
        changeMultiFilterModel({
            ...multiFilterModel,
            items: [...multiFilterModel.items, newFilterItem(column)],
        }, 'upsertFilterItem')
    }

    function changeMultiFilterModel(model: GridFilterModel, reason: MultiFilterReason) {
        if (filterModel === undefined)
            setLocalMultiFilterModel(model)
        if (apiRef.current)
            onFilterModelChange?.(model, { api: apiRef.current, reason })
    }

    async function saveFilterPreset() {
        const name = (await promptDialog("Preset name"))?.trim()
        if (!name) return
        persistFilterPresets({
            ...filterPresets,
            [name]: filterPresetFromModel(multiFilterModel),
        })
    }

    function loadFilterPreset(name: string) {
        changeMultiFilterModel(_.cloneDeep(filterPresets[name]), 'restoreState')
    }

    function deleteFilterPreset(name: string) {
        persistFilterPresets(_.omit(filterPresets, name))
    }

    function persistFilterPresets(next: FilterPresets) {
        if (!persist) return
        setFilterPresetsState(next)
        updateStateObject(state, 'dataTablePersistence', x => {
            x[persist] = { ...x[persist], filterPresets: next }
        })
    }

    function filterPresetFromModel(model: GridFilterModel): GridFilterModel {
        // MUI tags edits with private input state that must not survive as preset data
        return {
            items: model.items.map(({ id, field, operator, value }) => ({ id, field, operator, value })),
            logicOperator: model.logicOperator,
        }
    }

    function renderCell(col: GridColDef, row: any) {
        const api = apiRef.current
        let value = row[col.field]
        if (col.valueGetter) // @ts-ignore
            value = col.valueGetter(value, row, col, api)
        const render = (col as any).originalRenderCell || col.renderCell
        return render && render !== true ? render({ value, row, api, ...row })
            // @ts-ignore
            : col.valueFormatter ? col.valueFormatter(value, row, col, api)
                : value
    }
}

type MultiFilterReason = 'upsertFilterItem' | 'upsertFilterItems' | 'deleteFilterItem' | 'changeLogicOperator' | 'removeAllFilterItems' | 'restoreState'
type FilterPresets = Record<string, GridFilterModel>

function MultiFilterHeaderIconButton({ field, multiFilterModel, ...props }: ColumnHeaderFilterIconButtonProps & {
    multiFilterModel: GridFilterModel
}) {
    const apiRef = useGridApiContext()
    const counter = countActiveMultiFilters(field, multiFilterModel, apiRef)
    if (!counter) return null
    return h(Box, {
        // the grid hides this container because its internal filter model is deliberately empty
        sx: { display: 'contents', [`& .${gridClasses.iconButtonContainer}`]: { visibility: 'visible', width: 'auto' } },
    }, h(GridColumnHeaderFilterIconButton, { ...props, field, counter }))
}

function MultiFilterMenuItem({ colDef, onClick, onOpenMultiFilter }: {
    colDef: GridColDef
    onClick: (event: SyntheticEvent) => void
    onOpenMultiFilter: (column: GridColDef) => void
}) {
    const apiRef = useGridApiContext()
    const rootProps = useGridRootProps()
    if (rootProps.disableColumnFilter || colDef.filterable === false || !colDef.filterOperators?.length) return null
    return h(rootProps.slots.baseMenuItem, {
        onClick(event: SyntheticEvent) {
            onClick(event)
            onOpenMultiFilter(colDef)
            // open the native panel without calling showFilterPanel(field), which would replace the existing rules
            apiRef.current.showFilterPanel()
        },
        iconStart: h(rootProps.slots.columnMenuFilterIcon, { fontSize: 'small' }),
    }, apiRef.current.getLocaleText('columnMenuFilter'))
}

function MultiFilterPanel({ model, onChange, presets, onSavePreset, onLoadPreset, onDeletePreset }: {
    model: GridFilterModel
    onChange: (model: GridFilterModel, reason: MultiFilterReason) => void
    presets?: FilterPresets
    onSavePreset?: () => void
    onLoadPreset?: (name: string) => void
    onDeletePreset?: (name: string) => void
}) {
    const apiRef = useGridApiContext()
    const rootProps = useGridRootProps()
    const Button = rootProps.slots.baseButton
    const AddIcon = rootProps.slots.filterPanelAddIcon
    const RemoveAllIcon = rootProps.slots.filterPanelRemoveAllIcon
    const multiple = model.items.length > 1
    const activeFilters = countActiveMultiFilters(undefined, model, apiRef)
    return h(GridPanelWrapper, {},
        h(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, pl: 2 } },
            h(Box, { sx: { color: 'text.primary', fontWeight: 'bold' } }, "Filters"),
            h(rootProps.slots.baseIconButton, {
                'aria-label': "Close",
                title: "Close",
                size: 'small',
                onClick: () => apiRef.current.hideFilterPanel(),
            }, h(Close, { fontSize: 'small' })) ),
        _.isEmpty(model.items) ? h(Box, { sx: { ml: 2, mb: 1, fontStyle: 'italic', color: 'text.primary' } }, "none")
            : h(GridPanelContent, {}, model.items.map((item, index) =>
                h(GridFilterForm, {
                    key: item.id ?? index,
                    item,
                    hasMultipleFilters: multiple,
                    showMultiFilterOperators: index > 0,
                    disableMultiFilterOperator: index !== 1,
                    applyFilterChanges(updated) {
                        onChange({ ...model, items: model.items.map(x => x.id === updated.id ? updated : x) }, 'upsertFilterItem')
                    },
                    applyMultiFilterOperatorChanges(logicOperator) {
                        onChange({ ...model, logicOperator }, 'changeLogicOperator')
                    },
                    deleteFilter(deleted) {
                        onChange({ ...model, items: model.items.filter(x => x.id !== deleted.id) }, 'deleteFilterItem')
                        if (model.items.length === 1)
                            apiRef.current.hideFilterPanel()
                    },
                }))),
        presets && h(Flex, { px: 2, pb: 1, gap: 1, flexWrap: 'wrap', alignItems: 'center' },
            !_.isEmpty(presets) && h(Box, { sx: { color: 'text.primary' } }, "Presets:"),
            ..._.map(presets, (_preset, name) => h(Chip, {
                key: name,
                label: name,
                onClick: () => onLoadPreset?.(name),
                onDelete: () => onDeletePreset?.(name),
            })) ),
        h(GridPanelFooter, { sx: { justifyContent: 'flex-end', gap: 1 } },
            h(Button, { onClick: addFilter, startIcon: h(AddIcon, {}) }, "Add"),
            presets && h(Button, { disabled: !activeFilters, onClick: onSavePreset, startIcon: h(Save, {}) }, "Save"),
            model.items.length > 0 && h(Button, {
                onClick() {
                    onChange({ ...model, items: [] }, 'removeAllFilterItems')
                },
                startIcon: h(RemoveAllIcon, {}),
            }, apiRef.current.getLocaleText('filterPanelRemoveAll'))))

    function addFilter() {
        const column = apiRef.current.getAllColumns().find(x => x.filterable !== false && x.filterOperators?.length)
        if (!column) return
        onChange({ ...model, items: [...model.items, newFilterItem(column)] }, 'upsertFilterItems')
    }
}

function newFilterItem(column: GridColDef): GridFilterItem {
    return { id: crypto.randomUUID(), field: column.field, operator: column.filterOperators![0].value }
}

function DataTableQuickFilterToolbar({ onExpandedChange }: {
    onExpandedChange?: (expanded: boolean) => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        // focus after mount because the toolbar is created only after the header search button is pressed
        requestAnimationFrame(() => inputRef.current?.focus())
    }, [])
    return h(Box, {
        sx: {
            p: '4px 8px',
            '.MuiFormControl-root': { width: '100%' },
            '.MuiInputBase-root': { height: 36 },
            '.MuiInputAdornment-positionStart': {
                // MUI filled inputs reserve label space for adornments, but this toolbar field has no label
                mt: '3px !important',
            },
            '.MuiInputBase-input': { pt: '7px', pb: '6px' },
        }
    },
        h(QuickFilter, { expanded: true, debounceMs: 300, onExpandedChange },
            h(QuickFilterControl as ElementType, { fullWidth: true, inputRef, size: 'small', placeholder: "Search" })))
}

function CustomFooter({ add, ...props }: { add?: ReactNode }) {
    return h(GridFooterContainer, props, h(Box, { sx: { ml: { sm: 1 } } }, add), h(GridFooter, { sx: { border: 'none' } }))
}

function NoRowsOverlay({ initializing, noRows }: { initializing?: boolean, noRows?: ReactNode }) {
    return initializing ? null : h(Center, {}, noRows || "No entries")
}

// required in case of fillFlex:true
export const fillFlexParentSx = { display: 'flex', flexDirection: 'column' } as const

$(function(){
    $('#items').on({
        mouseenter: function(){
            if (!$(this).isOverflowed()) return; // is our label clipped?
            var lbl = $(this).find('.item-label');
            // make some changes so it's hopefully fully visible. We actually just mark it, leaving the real work to your css rules.
            lbl.addClass('full-label');
        },
        mouseleave: function(){
            // undo changes made few lines above
            var lbl = $(this).find('.full-label');
            lbl.removeClass('full-label');
            if (lbl.data('remove bg')) {
                lbl.css('background-color','');
                lbl.removeData('remove bg',null);
            }
        },
        click: itemClickHandler
    }, '.item-link');

    /* display:float used by 'tiles' is CPU expensive when we get many items (500+ on a core2duo@2.1).
     * To ease this task we periodically set fixed line breaks.
     */
    var last;
    repeat(100, function(){
        if (currentMode !== 'tiles') {
            last = null;
            return;
        }
        var d = $('#items');
        var x = d.children(':first').width();
        if (!x) return; // no items
        var n = Math.floor((d.width() - 5) / x); // leave a small margin, otherwise the browser decides it is not truly fitting, and you get an undesired wrapping
        if ($.support.hover) n--; // we leave some space for popup properties
        if (n === last) return;
        last = n;
        d.children('.forced-br').removeClass('forced-br'); // clean
        d.children(':nth-child({0}n+1):not(:first)'.x(n)).addClass('forced-br'); // set new br
    });


});

// rebuild the DOM of items
function redrawItems() {
    var x = $('#items').empty();

    if (!listFromServer) return;

    // add a link to the parent folder
    var cf = currentFolder; // shortcut
    if (cf > '/') {
        addItem({
            label: '&uarr;&uarr;',
            url: dirname(cf).includeTrailing('/'),
            type: 'folder',
            icon: 'folder'
        });
    }

    var n = listFromServer.items.length;
    var pages = Math.max(1, Math.ceil(n/currentPagination));
    if (currentPage >= pages) currentPage = pages-1;
    var overflow = (currentPagination && currentPagination < n);
    var ofs = overflow ? currentPage*currentPagination : 0;
    var max = currentPagination ? Math.min(currentPagination, n-ofs) : n;

    $('#paginator').remove();
    if (overflow) { // draw a paginator
        var d = $("<div id='paginator'>").insertBefore('#items');
        d.append("Pages ");
        for (var i=0; i<pages; i++) {
            $("<button>").text(i+1)
                .attr({page:i, disabled:i===currentPage}) // highlight current page (by disabling the button)
                .appendTo(d)
                .click(function(){
                    currentPage = +$(this).attr('page');if (it.jquery)
                    redrawItems();
                })
        }
    }

    for (var a=listFromServer.items, i=0; i<max; ++i) {
        var o = a[ofs+i]._clone(); // The item will be manipulated (also inside addItem), and we don't want to make this changes persistent over view modes
        o.icon = o.type;
        addItem(o);
    }
} // redrawItems

// build the DOM for the single item, applying possible filtering functions
function addItem(it) {
    it._expand({'icon-file':getIconURI(it.icon)}); // make this additions before the hook, so it can change these too
    TPL('onObjectItem', it); // custom treatment, especially mode-based
    $('<li>').append(TPL.item.format(it))
        .appendTo('#items');
} // addItem

// called when an item is clicked
function itemClickHandler(ev) {
    var x = $(this);
    var h = x.attr('href');
    if (h.substr(-1) == '/') {
        if (location.pathname != '/') { // reloads the page to have a neater URL
            location = '/#'+h.substr(1);
            return false;
        }

        location.hash = (h.startsWith(location.pathname)) ? h.substr(location.pathname.length) : h;
        var loader = $("<img src='/~/pics/loader.gif'>").css(x.find('.item-icon').offset()._expand({position:'absolute'})).appendTo('body');
        loadFolder(h, function(){ loader.remove() });
        return false;
    }
    if (!x.attr('target')) {
        x.attr('target', 'preview'); // open the file in a new window so the app doesn't stop
    }
    return true;
} // itemClickHandler


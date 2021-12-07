/**
 * @author Massimo Melina <a@rejetto.com>
 */

function loadJS(libs) {
    libs = libs.split(',');
    for (var i=libs.length; i--;) {
        document.write("<script src='/~/"+libs[i]+".js'></script>");
    } 
}

loadJS('extending,cs-shared,misc');


var socket, currentFolder, listFromServer, currentMode, foldersBefore=1, currentPage= 0;

// this object will hold all the customizable stuff, that is added in file "tpl.js"  
var TPL = function(event) {
    var fun = TPL[currentMode+'_'+event] || TPL[event];
    if (!fun) return;
    var newArgs = [];                               
    for (var i=1,a=arguments,l=a.length; i<l; ++i)
        newArgs.push(a[i]);         
    fun.apply(this, newArgs);
};

loadJS('frontend/tpl,frontend/vfs');

// understand the requested folder from the URL
function getURLfolder() {
    var sub = location.hash.substr(1);
    return sub.startsWith('/') ? sub : location.pathname+sub;
} // getURLfolder

$(function onJQ(){ // dom ready
    
    (function speedSetup() {

        function chooseSpeed(q, map, def){
            for (var k in map) {
                if (q <= k) return map[k];
            }
            return def;
        } // chooseSpeed
        
        $('#pagination').val( chooseSpeed(benchmark(), {
            5: 500,
            50: 200
        }, 50) );
    })();

    socket = io.connect(window.location.origin);
    
    socket.on('connect', function onIO(){ // socket ready
        log('connected');

        var saved = JSON.parse(getCookie('settings')) || {};
        ['Order','Mode','Pagination'].forEach(function(v){
            var lc = v.low();
            var update = window['update'+v];
            update(saved[lc]); // try to restore last options
            // change things at user will
            $('#'+lc).change(function(){ 
                update();
                redrawItems(); 
            }); 
        });
         
        loadFolder(getURLfolder(), function onFolder(){ // folder ready

            /* support for the BACK button: when the user clicks the BACK button, the address bar changes going out of   
                sync with the view. We fix it ASAP. I don't know an event for the address bar, so i'm polling. */
            repeat(300, function(){
                var shouldBe = getURLfolder(); 
                if (currentFolder != shouldBe) {
                    loadFolder(shouldBe);        
                } 
            });

        }); // don't redraw        
    });//socket connect
    
    socket.on('vfs.changed', function(data){
        log('vfs.changed',data);
        // it would be nicer to update only the changed item, but for now easily reload the whole dir
        var folder = data.uri.endsWith('/') ? data.uri : dirname(data.uri);
        if (folder === currentFolder) {
            loadFolder();            
        }
    });

});

// ask the server for the items list of the specified folder, then sort and display
function loadFolder(path /** optional */, cb /** optional */) {
    if (path) currentFolder = path;
    // breadcrumbs
    $('#folder').html(
        '<a href="/#"><img src="'+getPicURI('home')+'"/></a>'+
        // build pairs text/link
        decodeURI(currentFolder).split('/').filter('A').map('["/"+A, "/#"+C.slice(0,B+1).join("/")+"/"]')
        // then to html
            .map('$("<a>").text(A[0]).attr({href:A[1]})[0].outerHTML').join('')
    );

    socket.emit('get list', { path:currentFolder }, function onGetList(reply){
        if (showError(reply)) return;
        listFromServer = reply; // hold it in a global variable, to not loose it
        convertList(reply);
        $('#folder-info').html("Items: <span id='num-items'>{0}</span>".x(reply.items.length));
        sortItems();                
        redrawItems();
        if (typeof cb == 'function') {
            cb();
        }
    });
} // loadFolder

function showError(reply) {
    if (reply.ok) return false;
    if (reply.error) alert('Error: '+reply.error);
    return true;
} // showError

// convert file list format: expands some field-names
function convertList(serverReply) {
    if (!serverReply) return;
    var a = serverReply.items;
    if (!a) return;
    for (var i=a.length; i--;) {
        var o = a[i]._remapKeys({ n:'label', t:'type', s:'size'});
        switch (o.type) {
            case undefined: // no type is default type: file
                o.type = 'file'; // now continue with the case 'file'
            case 'file': // for files, calculate specific type
                var t = nameToType(o.label);
                if (t) o.type = t;
                break;
            case 'link':
                o.url = o.resource; 
                break;  
        }
        o.url = o.url || escapeLink(currentFolder+o.label)+(o.type == 'folder' ? '/' : '');
    }
} // convertList

function escapeLink(s) {
    //return encodeURI(s)
    return s.replace('"','&quot;').replace("'", '&#39;').replace('%','%25')
}

function updateSettingsCookie(settings) {
    var v = getCookie('settings');
    try { v = JSON.parse(v) }
    catch(e) {}
    if (!v || typeof v != 'object') v = {};
    v._expand(settings);
    setCookie('settings', JSON.stringify(v));
} // updateSettingsCookie

function updateMode(v){
    // if no value is passed, then read it from the DOM, otherwise write it in the DOM
    if (!v || !v.length) v = $('#mode').val(); 
    else $('#mode').val(v);

    currentMode = v; // global 
    updateSettingsCookie({ mode: v }); // remember 
    $('html').attr('mode', v);
} // updateMode

function updatePagination(v){
    // if no value is passed, then read it from the DOM, otherwise write it in the DOM
    if (!v || !v.length) v = $('#pagination').val(); 
    else $('#pagination').val(v);

    currentPagination = v; // global
    updateSettingsCookie({ pagination: v }); // remember 
    redrawItems();
} // updatePagination

function updateOrder(v) {
    // if no value is passed, then read it from the DOM, otherwise write it in the DOM
    if (!v || !v.length) v = $('#order').val();
    else $('#order').val(v);
    
    currentOrder = v; // global
    updateSettingsCookie({ order: v }); // remember
    if (v) {
        $('#order option[value=""]').remove(); // after we have sorted the items there's no way to return to the original order, so let's hide this option
    }
    sortItems();
} // updateOrder

function sortItems() {
    if (!currentOrder || !listFromServer) return; // no job

    listFromServer.items.sort(function cb(a,b,field){
        field = field || currentOrder;
        if (field != 'type' && foldersBefore) { // if field is 'type', then the folders are always put at the top
            var res = -cmp(a['type'] == 'folder', b['type'] == 'folder');
            if (res) return res;
        }
        var va = a[field];
        var vb = b[field];
        switch (field) {
            case 'label':
                va=va.low(), vb=vb.low();
                break;
            case 'type':
                if (va == 'folder') va=''; // trick to get folders at the top
                if (vb == 'folder') vb='';
                break;
        }
        return cmp(va,vb) || (field=='label' ? 0 : cb(a,b,'label'));
    });
} // sortItems

var JsonPrefix = '_jp';

var JsonPTransport = SockJS.jsonp = function(ri, trans_url){
    // Unavoidable namespace pollution.
    if (!(JsonPrefix in window)) {window[JsonPrefix] = {};}
    this.ri = ri;
    this.url = trans_url;
    this._send_buffer = [];
    this._schedule_recv();
};

JsonPTransport.prototype._schedule_recv = function() {
    var that = this;
    var callback = function(e, t) {
        that._recv_stop = undefined;
        if (typeof t === 'undefined') {
            // messages
            for(var i=0; i < e.length; i++) {
                that.ri._didMessage(e[i]);
            }
        } else {
            switch (t) {
            case 'open':
                that.ri._didOpen();
                break;
            case 'heartbeat':
                break;
            case 'close':
                if (e) {
                    that.ri._didClose(e.status, e.reason);
                } else {
                    that.ri._didClose(1001, "Server closed connection");
                }
                break;
            }
        }
        if (t !== 'close' && !that._is_closing) {
            that._schedule_recv();
        }
    };
    that._recv_stop = jsonPReceiverWrapper(this.url + '/jsonp',
                                           jsonPGenericReceiver, callback);
};

JsonPTransport.prototype.doClose = function(status, reason) {
    this._is_closing = true;
    if (this._recv_stop) {
        this._recv_stop();
    }
    if (this._send_stop) {
        this._send_stop();
    }
    this._recv_stop = this._send_stop = undefined;
    this.ri._didClose();
};

JsonPTransport.prototype.doSend = function(message) {
    var that = this;
    that._send_buffer.push(message);
    var _schedule_send = function () {
        if (that._send_buffer.length > 0) {
            that._send_stop = jsonPGenericSender(that.url+'/send', that._send_buffer,
                                                 function() {
                                                     that._send_stop = undefined;
                                                     _schedule_send();
                                                 });
            that._send_buffer = [];
        }
    };
    if (typeof that._send_stop === 'undefined') {
        _schedule_send();
    }
};

JsonPTransport.enabled = function() {
    return true;
};


var jsonPReceiverWrapper = function(url, constructReceiver, user_callback) {
    var id = 'a' + utils.random_string(6);
    var url_id = url + '?c=' + escape(JsonPrefix + '.' + id);
    var callback = function(e, t) {
        delete window[JsonPrefix][id];
        user_callback(e, t);
    };

    var close_script = constructReceiver(url_id, callback);
    window[JsonPrefix][id] = close_script;
    var stop = function() {
        if (window[JsonPrefix][id]) {
            close_script({status:1000, reson:"Normal closure"}, 'stop');
        }
    };
    return stop;
};

var jsonPGenericReceiver = function(url, callback) {
    var script = document.createElement('script');
    var close_script = function(v, t) {
        if (typeof script !== 'undefined') {
            callback(v, t);
            script.parentNode.removeChild(script);
            script.onreadystatechange = script.onerror = script.onload = null;
            delete script;
            script = callback = undefined;
        }
    };
    script.async = true;
    script.defer = true;
    script.src = url;
    script.type = 'text/javascript';
    script.charset = 'UTF-8';
    script.onerror = function(e) {
        close_script({status:1001, reason:"Onerror triggered on script"},
                     'close');
    };
    script.onload = function(e) {
        close_script({status:1001, reason:"Onload triggered on script"},
                     'close');
    };
    script.onreadystatechange = function(e) {
        if (script.readyState == 'loaded' ||
            script.readyState == 'complete') {
            close_script({status:1001, reason:"Onreadystatechange triggered on script"},
                         'close');
        }
    };
    var head = document.getElementsByTagName('head')[0];
    head.insertBefore(script, head.firstChild);
    return close_script;
};


var jsonPGenericSender = function(url, messages, callback) {
    var that = this;
    if (!('_send_form' in that)) {
        var form = that._send_form = document.createElement('form');
        var area = document.createElement('textarea');
        area.name = 'd';
        form.style.display = 'none';
        form.style.position = 'absolute';
        form.method = 'POST';
        form.enctype = 'application/x-www-form-urlencoded';
        form.appendChild(area);
        document.body.appendChild(form);
    }
    var form = that._send_form;
    var id = 'a' + utils.random_string(8);
    form.target = id;
    form.action = url + '?i=' + id;

    var iframe;
    try {
        // ie6 dynamic iframes with target="" support (thanks Chris Lambacher)
        iframe = document.createElement('<iframe name="'+ id +'">');
    } catch(x) {
        iframe = document.createElement('iframe');
        iframe.name = id;
    }
    iframe.id = id;
    form.appendChild(iframe);
    form.d.value = utils.stringsQuote(messages);
    form.submit();

    var completed = function() {
        form.removeChild(iframe);
        iframe.onreadystatechange = iframe.onerror = iframe.onload = null;
        iframe = undefined;
        form.d.value = undefined;
        form.target = undefined;
        form.reset();
        callback();
    };
    iframe.onerror = iframe.onload = completed;
    iframe.onreadystatechange = function(e) {
        if (iframe.readyState == 'complete') completed();
    };
    return completed;
};
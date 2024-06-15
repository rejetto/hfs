window.BigInt ||= Number; // avoid crash at boot for chrome66

/*
curl -H 'user-agent: Mozilla/5.0 (Android 4.4; Mobile; rv:41.0) Gecko/41.0 Firefox/40.0' \
'https://polyfill.io/v3/polyfill.min.js?features=Object.fromEntries%2CArray.prototype.flat%2CPromise.prototype.finally%2CString.prototype.replaceAll'
 */
/*
 * Polyfill service v3.111.0
 * Disable minification (remove `.min` from URL path) for more info
*/
(function (self, undefined) {
    function ArrayCreate (r) {
        if (1 / r == -Infinity && (r = 0), r > Math.pow(2, 32) - 1) throw new RangeError('Invalid array length')
        var n = []
        return n.length = r, n
    }

    function Call (t, l) {
        var n = arguments.length > 2 ? arguments[2] : []
        if (!1 === IsCallable(t)) throw new TypeError(Object.prototype.toString.call(t) + 'is not a function.')
        return t.apply(l, n)
    }

    function CreateDataProperty (e, r, t) {
        var a = { value: t, writable: !0, enumerable: !0, configurable: !0 }
        try {return Object.defineProperty(e, r, a), !0} catch (n) {return !1}
    }

    function CreateDataPropertyOrThrow (t, r, o) {
        var e = CreateDataProperty(t, r, o)
        if (!e) throw new TypeError(
            'Cannot assign value `' + Object.prototype.toString.call(o) + '` to property `' + Object.prototype.toString.call(r) + '` on object `' +
            Object.prototype.toString.call(t) + '`')
        return e
    }

    function CreateMethodProperty (e, r, t) {
        var a = { value: t, writable: !0, enumerable: !1, configurable: !0 }
        Object.defineProperty(e, r, a)
    }

    function Get (n, t) {return n[t]}

    function HasProperty (n, r) {return r in n}

    function IsArray (r) {return '[object Array]' === Object.prototype.toString.call(r)}

    function IsCallable (n) {return 'function' == typeof n}

    function RequireObjectCoercible (e) {
        if (null === e || e === undefined) throw TypeError(Object.prototype.toString.call(e) + ' is not coercible to Object.')
        return e
    }

    function ToBoolean (o) {return Boolean(o)}

    function ToObject (e) {
        if (null === e || e === undefined) throw TypeError()
        return Object(e)
    }

    function GetV (t, e) {return ToObject(t)[e]}

    function GetMethod (e, n) {
        var r = GetV(e, n)
        if (null === r || r === undefined) return undefined
        if (!1 === IsCallable(r)) throw new TypeError('Method not callable: ' + n)
        return r
    }

    function Type (e) {
        switch (typeof e) {
            case'undefined':
                return 'undefined'
            case'boolean':
                return 'boolean'
            case'number':
                return 'number'
            case'string':
                return 'string'
            case'symbol':
                return 'symbol'
            default:
                return null === e ? 'null' : 'Symbol' in self && (e instanceof self.Symbol || e.constructor === self.Symbol) ? 'symbol' : 'object'
        }
    }

    function GetIterator (t) {
        var e = arguments.length > 1 ? arguments[1] : GetMethod(t, Symbol.iterator), r = Call(e, t)
        if ('object' !== Type(r)) throw new TypeError('bad iterator')
        var o = GetV(r, 'next'), a = Object.create(null)
        return a['[[Iterator]]'] = r, a['[[NextMethod]]'] = o, a['[[Done]]'] = !1, a
    }

    function GetPrototypeFromConstructor (t, o) {
        var r = Get(t, 'prototype')
        return 'object' !== Type(r) && (r = o), r
    }

    function OrdinaryCreateFromConstructor (r, e) {
        var t = arguments[2] || {}, o = GetPrototypeFromConstructor(r, e), a = Object.create(o)
        for (var n in t) Object.prototype.hasOwnProperty.call(t, n) &&
        Object.defineProperty(a, n, { configurable: !0, enumerable: !1, writable: !0, value: t[n] })
        return a
    }

    var GetSubstitution = function () {
        function e (e) {return /^[0-9]$/.test(e)}

        return function t (n, r, l, i, a, f) {
            for (var s = n.length, h = r.length, c = l + s, u = i.length, v = '', g = 0; g < f.length; g += 1) {
                var o = f.charAt(g), $ = g + 1 >= f.length, d = g + 2 >= f.length
                if ('$' !== o || $) v += f.charAt(g)
                else {
                    var p = f.charAt(g + 1)
                    if ('$' === p) v += '$', g += 1
                    else if ('&' === p) v += n, g += 1
                    else if ('`' === p) v += 0 === l ? '' : r.slice(0,
                        l - 1), g += 1
                    else if ('\'' === p) v += c >= h ? '' : r.slice(c), g += 1
                    else {
                        var A = d ? null : f.charAt(g + 2)
                        if (!e(p) || '0' === p || !d && e(A)) if (e(p) && (d || e(A))) {
                            var y = p + A, I = parseInt(y, 10) - 1
                            v += y <= u && 'Undefined' === Type(i[I]) ? '' : i[I], g += 2
                        } else v += '$'
                        else {
                            var T = parseInt(p, 10)
                            v += T <= u && 'Undefined' === Type(i[T - 1]) ? '' : i[T - 1], g += 1
                        }
                    }
                }
            }
            return v
        }
    }()

    function IsConstructor (t) {return 'object' === Type(t) && ('function' == typeof t && !!t.prototype)}

    function Construct (r) {
        var t = arguments.length > 2 ? arguments[2] : r, o = arguments.length > 1 ? arguments[1] : []
        if (!IsConstructor(r)) throw new TypeError('F must be a constructor.')
        if (!IsConstructor(t)) throw new TypeError('newTarget must be a constructor.')
        if (t === r) return new (Function.prototype.bind.apply(r, [null].concat(o)))
        var n = OrdinaryCreateFromConstructor(t, Object.prototype)
        return Call(r, n, o)
    }

    function ArraySpeciesCreate (e, r) {
        if (0 === r && 1 / r == -Infinity && (r = 0), !1 === IsArray(e)) return ArrayCreate(r)
        var n = Get(e, 'constructor')
        if ('object' === Type(n) && null === (n = 'Symbol' in self && 'species' in self.Symbol ? Get(n, self.Symbol.species) : undefined) &&
        (n = undefined), n === undefined) return ArrayCreate(r)
        if (!IsConstructor(n)) throw new TypeError('C must be a constructor')
        return Construct(n, [r])
    }

    function IsRegExp (e) {
        if ('object' !== Type(e)) return !1
        var n = 'Symbol' in self && 'match' in self.Symbol ? Get(e, self.Symbol.match) : undefined
        if (n !== undefined) return ToBoolean(n)
        try {
            var t = e.lastIndex
            return e.lastIndex = 0, RegExp.prototype.exec.call(e), !0
        } catch (l) {} finally {e.lastIndex = t}
        return !1
    }

    function IteratorClose (r, t) {
        if ('object' !== Type(r['[[Iterator]]'])) throw new Error(Object.prototype.toString.call(r['[[Iterator]]']) + 'is not an Object.')
        var e = r['[[Iterator]]'], o = GetMethod(e, 'return')
        if (o === undefined) return t
        try {var n = Call(o, e)} catch (c) {var a = c}
        if (t) return t
        if (a) throw a
        if ('object' !== Type(n)) throw new TypeError('Iterator\'s return method returned a non-object.')
        return t
    }

    function IteratorComplete (t) {
        if ('object' !== Type(t)) throw new Error(Object.prototype.toString.call(t) + 'is not an Object.')
        return ToBoolean(Get(t, 'done'))
    }

    function IteratorNext (t) {
        if (arguments.length < 2) var e = Call(t['[[NextMethod]]'], t['[[Iterator]]'])
        else e = Call(t['[[NextMethod]]'], t['[[Iterator]]'], [arguments[1]])
        if ('object' !== Type(e)) throw new TypeError('bad iterator')
        return e
    }

    function IteratorStep (t) {
        var r = IteratorNext(t)
        return !0 !== IteratorComplete(r) && r
    }

    function IteratorValue (t) {
        if ('object' !== Type(t)) throw new Error(Object.prototype.toString.call(t) + 'is not an Object.')
        return Get(t, 'value')
    }

    var AddEntriesFromIterable = function () {
        var r = {}.toString, t = ''.split
        return function e (a, o, n) {
            if (!1 === IsCallable(n)) throw new TypeError('adder is not callable.')
            for (var l = GetIterator(o); ;) {
                var c = IteratorStep(l)
                if (!1 === c) return a
                var i = IteratorValue(c)
                if ('object' !== Type(i)) {
                    var s = new TypeError('nextItem is not an object')
                    throw IteratorClose(l, s), s
                }
                i = ('string' === Type(i) || i instanceof String) && '[object String]' == r.call(i) ? t.call(i, '') : i
                var I
                try {I = Get(i, '0')} catch (I) {return IteratorClose(l, I)}
                var u
                try {u = Get(i, '1')} catch (u) {return IteratorClose(l, u)}
                try {Call(n, a, [I, u])} catch (v) {return IteratorClose(l, v)}
            }
        }
    }()

    function OrdinaryToPrimitive (r, t) {
        if ('string' === t) var e = ['toString', 'valueOf']
        else e = ['valueOf', 'toString']
        for (var i = 0; i < e.length; ++i) {
            var n = e[i], a = Get(r, n)
            if (IsCallable(a)) {
                var o = Call(a, r)
                if ('object' !== Type(o)) return o
            }
        }
        throw new TypeError('Cannot convert to primitive.')
    }

    function SpeciesConstructor (e, o) {
        var r = Get(e, 'constructor')
        if (r === undefined) return o
        if ('object' !== Type(r)) throw new TypeError('O.constructor is not an Object')
        var n = 'function' == typeof self.Symbol && 'symbol' == typeof self.Symbol.species ? r[self.Symbol.species] : undefined
        if (n === undefined || null === n) return o
        if (IsConstructor(n)) return n
        throw new TypeError('No constructor found')
    }

    !function () {
        var t = Function.prototype.bind.call(Function.prototype.call, Promise.prototype.then), o = function (t, o) {return new t(function (t) {t(o())})}
        CreateMethodProperty(Promise.prototype, 'finally', function (e) {
            var r = this
            if ('object' !== Type(r)) throw new TypeError(
                'Method %PromisePrototype%.finally called on incompatible receiver ' + Object.prototype.toString.call(r))
            var n = SpeciesConstructor(r, Promise)
            if (!1 === IsCallable(e)) var i = e, c = e
            else i = function (r) {return t(o(n, e), function () {return r})}, c = function (r) {
                return t(o(n, e), function () {throw r})
            }
            return t(r, i, c)
        })
    }()

    function StringIndexOf (r, n, e) {
        var f = r.length
        if ('' === n && e <= f) return e
        for (var t = n.length, a = e, i = -1; a + t <= f;) {
            for (var g = !0, o = 0; o < t; o += 1) if (r[a + o] !== n[o]) {
                g = !1
                break
            }
            if (g) {
                i = a
                break
            }
            a += 1
        }
        return i
    }

    function ToInteger (n) {
        if ('symbol' === Type(n)) throw new TypeError('Cannot convert a Symbol value to a number')
        var t = Number(n)
        return isNaN(t) ? 0 : 1 / t === Infinity || 1 / t == -Infinity || t === Infinity || t === -Infinity ? t : (t < 0 ? -1 : 1) * Math.floor(Math.abs(t))
    }

    function ToLength (n) {
        var t = ToInteger(n)
        return t <= 0 ? 0 : Math.min(t, Math.pow(2, 53) - 1)
    }

    function ToPrimitive (e) {
        var t = arguments.length > 1 ? arguments[1] : undefined
        if ('object' === Type(e)) {
            if (arguments.length < 2) var i = 'default'
            else t === String ? i = 'string' : t === Number && (i = 'number')
            var r = 'function' == typeof self.Symbol && 'symbol' == typeof self.Symbol.toPrimitive ? GetMethod(e, self.Symbol.toPrimitive) : undefined
            if (r !== undefined) {
                var n = Call(r, e, [i])
                if ('object' !== Type(n)) return n
                throw new TypeError('Cannot convert exotic object to primitive.')
            }
            return 'default' === i && (i = 'number'), OrdinaryToPrimitive(e, i)
        }
        return e
    }

    function ToString (t) {
        switch (Type(t)) {
            case'symbol':
                throw new TypeError('Cannot convert a Symbol value to a string')
            case'object':
                return ToString(ToPrimitive(t, String))
            default:
                return String(t)
        }
    }

    CreateMethodProperty(String.prototype, 'replaceAll', function e (r, t) {
        'use strict'
        var n = RequireObjectCoercible(this)
        if (r !== undefined && null !== r) {
            if (IsRegExp(r)) {
                var i = Get(r, 'flags')
                if (!('flags' in RegExp.prototype || !0 === r.global)) throw TypeError('')
                if ('flags' in RegExp.prototype && (RequireObjectCoercible(i), -1 === ToString(i).indexOf('g'))) throw TypeError('')
            }
            var l = 'Symbol' in self && 'replace' in self.Symbol ? GetMethod(r, self.Symbol.replace) : undefined
            if (l !== undefined) return Call(l, r, [n, t])
        }
        var o = ToString(n), a = ToString(r), f = IsCallable(t)
        !1 === f && (t = ToString(t))
        for (var g = a.length, s = Math.max(1, g), u = [], p = StringIndexOf(o, a, 0); -1 !== p;) u.push(p), p = StringIndexOf(o, a, p + s)
        for (var d = 0, b = '', S = 0; S < u.length; S++) {
            var h = o.substring(d, u[S])
            if (f) var c = ToString(Call(t, undefined, [a, u[S], o]))
            else {
                var v = []
                c = GetSubstitution(a, o, u[S], v, undefined, t)
            }
            b = b + h + c, d = u[S] + g
        }
        return d < o.length && (b += o.substring(d)), b
    })

    function FlattenIntoArray (r, t, e, a, n) {
        for (var o = arguments[5], i = arguments[6], l = a, g = 0; g < e;) {
            var h = ToString(g)
            if (!0 === HasProperty(t, h)) {
                var y = Get(t, h)
                5 in arguments && (y = Call(o, i, [y, g, t]))
                var f = !1
                if (n > 0 && (f = IsArray(y)), !0 === f) {l = FlattenIntoArray(r, y, ToLength(Get(y, 'length')), l, n - 1)} else {
                    if (l >= Math.pow(2, 53) - 1) throw new TypeError('targetIndex is greater than or equal to 2^53-1')
                    CreateDataPropertyOrThrow(r, ToString(l), y), l += 1
                }
            }
            g += 1
        }
        return l
    }

    CreateMethodProperty(Array.prototype, 'flat', function t () {
        'use strict'
        var t = arguments[0], e = ToObject(this), r = ToLength(Get(e, 'length')), o = 1
        void 0 !== t && (o = ToInteger(t))
        var a = ArraySpeciesCreate(e, 0)
        return FlattenIntoArray(a, e, r, 0, o), a
    })

    function ToPropertyKey (r) {
        var i = ToPrimitive(r, String)
        return 'symbol' === Type(i) ? i : ToString(i)
    }

    CreateMethodProperty(Object, 'fromEntries', function r (e) {
        RequireObjectCoercible(e)
        var t = {}, o = function (r, e) {
            var t = this, o = ToPropertyKey(r)
            CreateDataPropertyOrThrow(t, o, e)
        }
        return AddEntriesFromIterable(t, e, o)
    })

    ;(function (global) {
        if (global.AbortController && global.AbortSignal) return

        function AbortSignal () {
            this.aborted = false
            this._listeners = []
        }

        AbortSignal.prototype.addEventListener = function (type, listener) {
            if (type === 'abort') this._listeners.push(listener)
        }

        AbortSignal.prototype.removeEventListener = function (type, listener) {
            if (type === 'abort') {
                var index = this._listeners.indexOf(listener)
                if (index !== -1) this._listeners.splice(index, 1)
            }
        }

        AbortSignal.prototype.dispatchEvent = function (event) {
            if (event.type === 'abort') {
                this.aborted = true
                this._listeners.forEach(listener => listener.call(this, event))
            }
        }

        function AbortController () {
            this.signal = new AbortSignal()
        }

        AbortController.prototype.abort = function () {
            this.signal.dispatchEvent({ type: 'abort' })
        }

        global.AbortController = AbortController
        global.AbortSignal = AbortSignal
    })(typeof self !== 'undefined' ? self : this);

})('object' === typeof window && window || 'object' === typeof self && self || 'object' === typeof global && global || {})
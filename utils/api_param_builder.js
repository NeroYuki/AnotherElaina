class apiParamBuilder {
    constructor(call) {
        this._apicall = [call]
        this._param = []
    }
    addParam(key, value) {
        this._param.push({key: key, value: value})
    }
    addCall(call) {
        this._apicall.push(call)
    }
    toString() {
        let res = ""
        for (var i = 0; i < this._apicall.length; i++) {
            res += "/" + this._apicall[i]
        }
        if (this._param.length === 0) return res;
        res += "?"
        for (var i = 0; i < this._param.length; i++) {
            res += this._param[i].key + "=" + this._param[i].value
            if (i + 1 < this._param.length) res += "&"
        }
        return res
    }
}

module.exports = apiParamBuilder
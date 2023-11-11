function LogtoConsole(msg) {
    console.log(new Date(Date.now()).toTimeString() + ": " + msg)
}

function ErrortoConsole(msg) {
    //TODO: make a log file and upload to somewhere
    console.error(new Date(Date.now()).toTimeString() + ": " + msg)
}

class Timer {
    startTime = 0
    endTime = 0
    start() {
        this.startTime = new Date(Date.now())
    }
    end() {
        this.endTime = new Date(Date.now())
        console.log(new Date(Date.now()).toTimeString() + ": +" + (this.endTime - this.startTime) + "ms")
    }
}

module.exports.toConsole = LogtoConsole
module.exports.errConsole = ErrortoConsole
module.exports.TimertoConsole = Timer
// global property
const context_storage = new Map()
var is_generating = false
var operating_mode = "6bit" // disabled, 4bit or 6bit

module.exports = {
    context_storage,
    is_generating,
    operating_mode
}
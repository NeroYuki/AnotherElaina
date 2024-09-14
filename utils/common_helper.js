const fs = require('fs');

function listAllFiles(root_dir, current_dir = '', allFilesList = []) {
    if (current_dir === '') current_dir = root_dir
    const files = fs.readdirSync(current_dir);
    files.map(file => {
        const name = current_dir + '/' + file;
        if (fs.statSync(name).isDirectory()) { // check if subdirectory is present
            listAllFiles(root_dir, name, allFilesList);     // do recursive execution for subdirectory
        } else {
            // push filename relative to root_dir
            allFilesList.push(name.replace(root_dir + '/', ''));
        }
    })

    return allFilesList;
}

function convert_upload_path_to_file_data(upload_path, worker_endpoint) {
    if (!upload_path) {
        return null
    }
    // prune the server url
    upload_path = upload_path.replace(`${worker_endpoint}/file=`, '')
    return {
        path: upload_path,
        url: `${worker_endpoint}/file=${upload_path}`
    }
}


function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
}

module.exports = {
    listAllFiles,
    convert_upload_path_to_file_data,
    clamp
}

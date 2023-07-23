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

module.exports = {
    listAllFiles
}

const fs = require('fs')

const BASE_PATH = './resources/shipgirls'

let dirs = fs.readdirSync(BASE_PATH)

let list = []

dirs.forEach((dir) => {
    if ([".git", ".gitignore", "Current source.txt", "KanssenIndex-datamine", "KanssenIndex-web", "Franchise logo"].includes(dir)) return

    let list_entry = {
        name: dir,
        count: 0,
        img: [],
    }

    let files = fs.readdirSync(BASE_PATH + '/' + dir)
    files.forEach((file) => {
        if (!(file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.gif') || file.endsWith('.webp'))) return
        let char_name = file.split('.')[0].split('_')[0]
        list_entry.img.push({
            char: char_name,
            filename: BASE_PATH + '/' + dir + '/' + file
        })
    })

    list_entry.count = list_entry.img.length
    list.push(list_entry)
})

fs.writeFileSync('shipgirl_quiz.json', JSON.stringify(list, {}, '  '), {encoding: 'utf-8'})
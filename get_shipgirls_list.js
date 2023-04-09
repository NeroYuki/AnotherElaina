const fs = require('fs')
const config = require('./resources/shipgirl_quiz_config.json')

const BASE_PATH = './resources/shipgirls'

function main () {

    let dirs = fs.readdirSync(BASE_PATH)

    let list = []

    dirs.forEach((dir) => {
        if ([".git", ".gitignore", "Current source.txt", "KanssenIndex-datamine", "KanssenIndex-web", "Franchise logo", "Additional Note.txt", "desktop.ini"].includes(dir)) return

        let list_entry = {
            name: dir,
            count: 0,
            base_count: 0,
            img: [],
        }

        let entry_config = config.find(val => val.name === dir) || {}

        let base_count = 0
        let count = 0

        let files = fs.readdirSync(BASE_PATH + '/' + dir)
        files.forEach((file) => {
            if (!(file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.gif') || file.endsWith('.webp'))) return
            let comp = file.slice(0, file.lastIndexOf('.')).split('_')
            let char_name = comp[0]

            const isBase = (!comp[1] || (comp[1].toLowerCase() === entry_config.baseArtSuffix && !comp[2]))
            
            count += 1
            if (isBase) base_count += 1

            list_entry.img.push({
                char: char_name,
                filename: BASE_PATH + '/' + dir + '/' + file,
                is_base: isBase
            })
        })

        list_entry.count = count
        list_entry.base_count = base_count

        list.push(list_entry)
    })

    fs.writeFileSync('resources/shipgirl_quiz.json', JSON.stringify(list, {}, '  '), {encoding: 'utf-8'})
}

main()
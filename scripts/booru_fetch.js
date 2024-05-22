const fs = require('fs');

function fetchBooruArtists(page) {
  return new Promise((resolve, reject) => {
        fetch(`https://danbooru.donmai.us/artists.json?login=neroyuki&api_key=${process.env.BOORU_KEY}&page=${page}&limit=100&search[order]=post_count`)
            .then(response => response.json())
            .then(data => {
                resolve(data);
            })
            .catch(error => {
                console.error('Error:', error);
                reject(error);
            });
    })
}

function fetchBooruCharacters(page) {
    return new Promise((resolve, reject) => {
          fetch(`https://danbooru.donmai.us/tags.json?login=neroyuki&api_key=${process.env.BOORU_KEY}&page=${page}&limit=100&search[order]=count&search[category]=4&only=id,name,post_count`)
              .then(response => response.json())
              .then(data => {
                  resolve(data);
              })
              .catch(error => {
                  console.error('Error:', error);
                  reject(error);
              });
      })
  }

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchRelatedTags(tag, limit = 10) {
    return new Promise((resolve, reject) => {
        fetch(`https://danbooru.donmai.us/related_tag.json?login=neroyuki&api_key=${process.env.BOORU_KEY}&query=${tag}&category=copyright,general&limit=${limit}`)
            .then(response => response.json())
            .then(data => {
                resolve(data);
            })
            .catch(error => {
                console.error('Error:', error);
                reject(error);
            });
    })
}


async function fetchMultipleBooruArtists() {
    let artists = [];
    let page = 1;
    let data = []
    while (page < 400) {
        data = await fetchBooruArtists(page);
        artists = artists.concat(data);
        console.log(`Fetched page ${page}: ${data.length} artists. Total: ${artists.length} artists.`);
        page++;
        await sleep(500);
    }
    // save to JSON
    let json = JSON.stringify(artists);
    fs.writeFileSync('artists.json', json);

    // save to txt (only name field, escape parentheses)

    let txt = artists.map(artist => 'artist: ' + artist.name.replace(/[\(]/g, '\\(').replace(/[\)]/g, '\\)')).join('\n');
    fs.writeFileSync('artists_p400.txt', txt);
}

async function fetchMultipleBooruCharacters() {
    let characters = [];
    let page = 1;
    let data = []
    while (page < 400) {
        data = await fetchBooruCharacters(page);
        characters = characters.concat(data);
        console.log(`Fetched page ${page}: ${data.length} characters. Total: ${characters.length} characters.`);
        page++;
        await sleep(200);
    }
    // save to JSON
    let json = JSON.stringify(characters);
    fs.writeFileSync('characters.json', json);
}

async function fetchRelatedTagsForCharacters() {
    let characters = JSON.parse(fs.readFileSync('characters.json'));
    let finalTags = [];
    for (let i = 0; i < characters.length; i++) {
        let character = characters[i];

        // build final tag from related tags
        // format 1girl/1boy, character_name, copyright
        // from related.related_tags array, find object with tag.category = 3 appear on the top, it should be the copyright, find object with name is either 1girl or 1boy
        let retry = 0;
        let related = {}
        let copyrightIndex = -1
        let genderIndex = -1

        while (retry < 10) {
            if (retry > 0) console.log(`INFO: Retry fetching related tags for character: ${character.name}, retry: ${retry}`);

            related = await fetchRelatedTags(character.name, (retry + 1) * 10);
            genderIndex = related.related_tags.findIndex(o => o.tag.name === '1girl' || o.tag.name === '1boy');
            copyrightIndex = related.related_tags.findIndex(o => o.tag.category === 3);
            retry++;

            if (genderIndex !== -1 && copyrightIndex !== -1) break;
            await sleep(250);
        }

        if (genderIndex === -1) console.log('WARN: cant find gender info')
        if (copyrightIndex === -1) console.log('WARN: cant find copyright')

        let genderTag = genderIndex !== -1 ? related.related_tags[genderIndex].tag.name : '1girl';
        let copyrightTag = copyrightIndex !== -1 ? related.related_tags[copyrightIndex].tag.name : ''
        let finalTag = `${genderTag}, ${character.name}, ${copyrightTag}`;

        // clean up final tag
        finalTag = finalTag.replace(/[\(]/g, '\\(').replace(/[\)]/g, '\\)').replace(/_/g, ' ');
        console.log(finalTag);
        finalTags.push(finalTag);

        console.log(`Fetched related tags for character ${i+1}/${characters.length}: ${character.name}`);
        await sleep(500);

        if (i % 20 === 0) {
            let txt = finalTags.join('\n');
            fs.writeFileSync('characters_p400.txt', txt);
        }
    }
    // save to JSON
    
}

// fetchMultipleBooruCharacters();

fetchRelatedTagsForCharacters();
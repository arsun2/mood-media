const express = require('express');
const cors = require('cors')
const app = express();
var PythonShell = require('python-shell');
var bodyParser = require('body-parser')
var deasync = require('deasync');

var Genius = require('genius-api');
var cheerio = require('cheerio');
var fetch = require("node-fetch");
let globalLyrics = []

const accessToken = '5MQ-WVXQ1eYFdr5DSVIfntYVk5o-6GlCRdtfMwvUEP0y7Hm4G2lfYy7AjFio3q83'
const genius = new Genius(accessToken)

// Needed to pass information from the web client to the backend
app.use(cors())

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
app.use(bodyParser.json())

// Function used to parse the track objects received from the front end Spotify API call
function parseTracks(obj) {
  let resObj = []
  for(track in obj) {
    let parsedObj = {}
    songObj = obj[track]
    parsedObj['name'] = songObj.name
    parsedObj['artists'] = []

    // Get a list all of the artists for the song
    for(var artist in songObj.artists) {
      parsedObj['artists'].push(songObj.artists[artist].name)
    }
    resObj.push(parsedObj)
  }
  return resObj
}

// Necessary for creating a promise to get the lyrics of each song
function getLyricsPromise(artist, track, genius) {
  return genius.getArtistIdByName(artist)
    .then(function(id) {
        return genius.getSongsByArtist(id, track)
    })
}

// Loops through each item in the tracks list, and creates lyrics promise
function getLyrics(tracks) {
  let resObj = []
  let promiseList = []
  const genius = new Genius(accessToken)
  tracks.forEach(function(listItem, index) {
    promiseList.push(getLyricsPromise(listItem.artists[0], listItem.name, genius))
  })
  return promiseList
}

// Genius API does not have an artist entrypoint.
// Instead, search for the artist => get a song by that artist => get API info on that song => get artist id
Genius.prototype.getArtistIdByName = function getArtistIdByName(artistName) {
  const normalizeName = name => name.replace(/\./g, '').toLowerCase()   // regex removes dots
  const artistNameNormalized = normalizeName(artistName)

  return this.search(artistName)
    .then((response) => {
      for (let i = 0; i < response.hits.length; i += 1) {
        const hit = response.hits[i]
        if (hit.type === 'song' && normalizeName(hit.result.primary_artist.name) === artistNameNormalized) {
          return hit.result
        }
      }
      throw new Error(`Did not find any songs whose artist is "${artistNameNormalized}".`)
    })
    .then(songInfo => songInfo.primary_artist.id)
}

// Genius API call to get the lyrics based on the artist ID (to get the top 50 songs of the artist) and track name
Genius.prototype.getSongsByArtist = function getSongsByArtist(artistId, trackName) {
  const normalize = name => name.replace(/\./g, '').toLowerCase()   // regex removes dots
  const trackNameNormalized = normalize(trackName).replace(/ *\([^)]*\) */g, "") // added regex to remove parentheses (eg. "(feat drake)")

  var urls_array = []
  const genius = new Genius(accessToken)
  // Genius API only allows us to get maximum of 50 items in one time.
  // So here we're getting top 50 songs of the artist based on popularity.
  return genius.songsByArtist(artistId, {
      per_page: 50,
      sort: 'popularity',
    })
    .then(function(data) {
      // For each songs, push it to the urls_array with song title and lyrics url
      urls_array = data.songs.map(song => ({title: song.title, url: song.url}))

      // Finding the object with the same track name in the array and return it.
      for(let i = 0; i < urls_array.length ; i++) {
        let item = urls_array[i]
        if (normalize(item.title) === trackNameNormalized) {
          return item.url
        }
      }
    }).then((lyricURL) => {
      // In case the lyric URL was not found, just return an empty string to put in the lyric list
      if(lyricURL) {
        return genius.getSongLyrics(lyricURL)
      }
      else {
        return ''
      }
    })
}

// Using a genius lyric URL, return a string version of the lyrics
Genius.prototype.getSongLyrics = function getSongLyrics(geniusUrl) {
  return fetch(geniusUrl, {
    method: 'GET',
  })
  .then(response => {
    if (response.ok) return response.text()
    throw new Error('Could not get song url ...')
  })
  .then(parseSongHTML)
}

// Gets the lyrics from the htmlText returned
function parseSongHTML(htmlText) {
  const $ = cheerio.load(htmlText)
  const lyrics = $('.lyrics').text()
  const releaseDate = $('release-date .song_info-info').text()
  return lyrics
}

// POST method route
// Used to receive the track list from the front end
// Returns a list of URI's for songs that match the mood of the user
app.post('/music', function (req, res) {
  console.log('Received Music POST Request')
  let mood = req.body.mood
  let parsedTracks = parseTracks(req.body.tracks)
  let promiseList = getLyrics(parsedTracks)

  // Promise List is for every call to get song lyrics
  let p = Promise.all(promiseList).then(songLyrics => {

    let options = {
      mode: 'text',
      scriptPath: __dirname,
      args: []
    }
    // Push each of the song lyrics strings to the Python script
    for(song in songLyrics) {
      options.args.push(songLyrics[song])
    }
    options.args.push(mood)
    PythonShell.run('mood.py', options, function (err, results) {
    if (err) { throw err; }
    resUris = []
    for(index in req.body.tracks) {
      if(results[index] == "True") {
        resUris.push(req.body.tracks[index].uri)
      }
    }
    res.send({ status: 'SUCCESS', uris: resUris})
    })
  })
})

app.post('/movies', function (req, res) {
  console.log('Received Movie POST Request')

  let options = {
    mode: 'text',
    scriptPath: __dirname,
    args: []
  }
  // Push each of the overview strings to the Python script
  // Also push the mood these strings need to match
  for(overview in req.body.overviews) {
    options.args.push(req.body.overviews[overview])
  }
  options.args.push(req.body.mood)
  PythonShell.run('mood.py', options, function (err, results) {
    if (err) { throw err; }
    res.send({ status: 'SUCCESS', movie_bools: results})
  })
})

const port = 5000;

app.listen(port, () => `Server running on port ${port}`);

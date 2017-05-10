#!/usr/bin/env node

var zim = require('./')
var fs = require('fs')
var path = require('path')
var ndjson = require('ndjson')
var through = require('through2')
var pump = require('pump')
var minimist = require('minimist')
var mkdirp = require('mkdirp')

var args = minimist(process.argv.slice(2))
var cmd = args._[0]
var filename = args._[args._.length - 1]

if (!cmd) usage()
  
if (!filename || args._.length === 1) {
  filename = cmd
  cmd = 'stream'
}

if (cmd === 'extract') {
  filename = args._[1]
}
  
function usage () {
   console.log(`zimmer zim parser - usage

   zimmer <filename>               - streams all entry metadata + data to stdout'
   zimmer extract <filename> <out> - extracts and writes files to output dir
   zimmer header <num> <filename>  - reads zim header
   zimmer entries <filename>       - streams all entry metadata to stdout
   zimmer entry <num> <filename>   - reads specific entry data by index
   zimmer clusters <filename>      - streams all cluster metadata to stdout
   zimmer cluster <num> <filename> - reads specific cluster data by index`
   )
   process.exit(1)
}

fs.open(filename, 'r', function (err, file) {
  if (err) throw err
  zim.readHeader(file, function(err, header) {
    if (err) throw err
    if (cmd === 'header') {
      console.log(JSON.stringify(header))
      return
    }
    
    if (cmd === 'stream') {
      var pointers = zim.createEntryPointerStream(filename, header)
      var reader = through.obj(function(entry, enc, cb) {
        zim.readDirectoryEntry(filename, file, header, entry, function (err, entry) {
          if (err) return cb(err)
          if (!entry.cluster) return cb(null, {entry: entry})
          zim.readCluster(filename, file, header, {index: entry.cluster}, function (err, cluster) {
            if (err) return cb(err)
            entry.contents = cluster.blobs[entry.blob].toString()
            cb(null, entry)
          })
        })
      })
    
      pump(pointers, reader, ndjson.serialize(), process.stdout, function (err) {
        if (err) throw err
      })
      return
    }
    
    if (cmd === 'entries') {
      var pointers = zim.createEntryPointerStream(filename, header)
      var reader = through.obj(function(entry, enc, cb) {
        zim.readDirectoryEntry(filename, file, header, entry, cb)
      })
    
      pump(pointers, reader, ndjson.serialize(), process.stdout, function (err) {
        if (err) throw err
      })
      return
    }
    
    if (cmd === 'entry') {
      var idx = args._[1]
      zim.readDirectoryEntry(filename, file, header, {index: idx}, function (err, entry) {
        if (err) throw err
        zim.readCluster(filename, file, header, {index: entry.cluster}, function (err, cluster) {
          if (err) throw err
          var contents = cluster.blobs[entry.blob].toString()
          entry.contents = contents
          console.log(JSON.stringify(entry))
        })
      })
      return
    }
    
    if (cmd === 'extract') {
      var out = args._[2] || process.cwd()
      mkdirp(out, function (err) {
        if (err) throw err
        extract()
      })
      
      function extract () {
        var pointers = zim.createEntryPointerStream(filename, header)
        var writer = through.obj(function(entry, enc, cb) {
          zim.readDirectoryEntry(filename, file, header, entry, function (err, entry) {
            if (err) return cb(err)
            if (!entry.cluster) return cb()
            zim.readCluster(filename, file, header, {index: entry.cluster}, function (err, cluster) {
              if (err) return cb(err)
              var contents = cluster.blobs[entry.blob].toString()
              var saveAs = path.join(out, entry.url)
              var saveDir = path.dirname(saveAs)
              mkdirp(saveDir, function (err) {
                if (err) return cb(err)
                fs.writeFile(saveAs, contents, function (err) {
                  if (err) return cb(err)
                  cb(null, {finished: true, path: saveAs})
                })
              })
            })
          })
        })
    
        pump(pointers, writer, ndjson.serialize(), process.stdout, function (err) {
          if (err) throw err
        })
      }

      return
    }
    
    if (cmd === 'clusters') {
      var pointers = zim.createClusterPointerStream(filename, header)
      var reader = through.obj(function(entry, enc, cb) {
        zim.readDirectoryEntry(filename, file, header, entry, cb)
      })
    
      pump(pointers, ndjson.serialize(), process.stdout, function (err) {
        if (err) throw err
      })
      return
    }
    
    if (cmd === 'cluster') {
      var idx = args._[1]
      zim.readCluster(filename, file, header, {index: idx}, function (err, cluster) {
        if (err) throw err
        cluster.blobs = cluster.blobs.map(function (b) { return b.toString() })
        console.log(JSON.stringify(cluster))
      })
      return
    }
    
    usage()
  })
})




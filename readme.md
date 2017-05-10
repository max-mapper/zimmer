# zimmer

streaming/random access parser for the ZIM aka OpenZIM file format http://www.openzim.org/wiki/ZIM_file_format

requires the `lzma-native` native dependency for `xz` decompression (no pure js version available as of 2017)

### api

```js
var zimmer = require('zimmer')

zimmer.readHeader(fd, function (err, header) {})

var readable = zimmer.createOffsetStream(filename, start, num, opts)

var readable = zimmer.createClusterPointerStream(filename, header, opts)
var readable = zimmer.createEntryPointerStream(filename, header, opts)

zimmer.readDirectoryEntry(filename, fd, header, {index: 1}, function (err, entry) { })
zimmer.readCluster(filename, fd, header, {index: entry.cluster}, function (err, cluster) { })
```

### command line cli

```
$ npm install zimmer -g

$ zimmer
zimmer zim parser - usage

   zimmer <filename>               - streams all entry metadata + data to stdout'
   zimmer extract <filename> <out> - extracts and writes files to output dir
   zimmer header <num> <filename>  - reads zim header
   zimmer entries <filename>       - streams all entry metadata to stdout
   zimmer entry <num> <filename>   - reads specific entry data by index
   zimmer clusters <filename>      - streams all cluster metadata to stdout
   zimmer cluster <num> <filename> - reads specific cluster data by index
```

## examples

read a single entry's data by index:

```js
var filename = 'data.zim'
var index = 1

fs.open(filename, 'r', function (err, file) {
  if (err) throw err
  zim.readHeader(file, function(err, header) {
    if (err) throw err
    zim.readDirectoryEntry(filename, file, header, {index: index}, function (err, entry) {
      if (err) throw err
      zim.readCluster(filename, file, header, {index: entry.cluster}, function (err, cluster) {
        if (err) throw err
        var contents = cluster.blobs[entry.blob]
        // contents is a buffer
      })
    })
  })
})
```

read all entry data as a stream and pipe as ndjson to stdout

```js
var pump = require('pump')
var ndjson = require('ndjson')
var filename = 'data.zim'

fs.open(filename, 'r', function (err, file) {
  if (err) throw err
  zim.readHeader(file, function(err, header) {
    if (err) throw err
    var pointers = zim.createEntryPointerStream(filename, header)
    var reader = through.obj(function(entry, enc, cb) {
      zim.readDirectoryEntry(filename, file, header, entry, function (err, entry) {
        if (err) throw err
        if (!entry.cluster) return cb(null, {entry: entry})
        zim.readCluster(filename, file, header, {index: entry.cluster}, function (err, cluster) {
          if (err) return cb(err)
          cb(null, {entry: entry, blob: cluster.blobs[entry.blob].toString()})
        })
      })
    })
    pump(pointers, reader, ndjson.serialize(), process.stdout, function (err) {
      if (err) throw err
    })
  })
})
```

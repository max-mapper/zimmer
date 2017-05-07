var fs = require('fs')
var choppa = require('choppa')
var pump = require('pump')
var through = require('through2')
var concat = require('concat-stream')
var pump = require('pump')
var debug = require('debug')('zimmer')

module.exports = {
  readHeader: readHeader,
  createOffsetStream: createOffsetStream,
  createClusterPointerStream: createClusterPointerStream,
  createEntryPointerStream: createEntryPointerStream,
  readDirectoryEntry: readDirectoryEntry,
  readCluster: readCluster
}

function read (fd, start, end, cb) {
  var len = end - start + 1
  var buf = new Buffer(len)
  fs.read(fd, buf, 0, len, start, function (err) {
    cb(err, buf)
  })
}

function readOffset (file, offset, entry, cb) {
  var start = offset + entry.index * 8
  var end = start + 8 - 1

  return read(file, start, end, function (err, buf) {
    if (err) return cb(err)
    if (buf.length < 8) return cb(new Error('Not enough data'))
    entry.offset = readUInt64LE(buf, 0)
    cb()
  })
}

function readClusterEntry (file, header, cluster, cb) {
  if (cluster.offset !== undefined) {
    cb(null, cluster)
    return noop
  }

  return readOffset(file, header.clusterPtrPos, cluster, function (err) {
    if (err) return cb(err)
    cb(null, cluster)
  })
}

function readCluster (filename, file, header, cluster, cb) {
  if (cluster.offset !== undefined) {
    ready()
    return
  }

  readOffset(file, header.clusterPtrPos, cluster, ready)
  
  function ready (err) {
    if (err) return cb(err)
      
    var nextCluster = {index: cluster.index + 1}
    if (nextCluster.index > header.clusterCount - 1) {
      nextCluster = false
      return readFirstCluster
    }

    readOffset(file, header.clusterPtrPos, nextCluster, function (err) {
      if (err) return cb(err)
      readFirstCluster()
    })
    
    function readFirstCluster () {
      if (cluster.blobs === false) return cb(null, cluster)

      read(file, cluster.offset, cluster.offset, function (err, compressed) {
        compressed = compressed[0]
        debug('cluster is compressed? %s (%d)', compressed !== 0, compressed)
        
        var offsets = {start: cluster.offset + 1, end: nextCluster ? nextCluster.offset - 1 : null}
        var stream = fs.createReadStream(filename, offsets)
        var decomp = compressed < 2 ? through() : require('lzma-native').createDecompressor()
        var indexes = []
        var blobs = []

        var concatter = concat(function (data) {
          stream.destroy()
          index(data)
          for (var i = 0; i < indexes.length-1; i++) blobs.push(data.slice(indexes[i], indexes[i+1]))
          cluster.blobs = blobs
        })
      
        pump(stream, decomp, concatter, function (err) {
          cb(err, cluster)
        })
      
        function index (data) {
          while (data.length) {
            var offset = data.readUInt32LE(indexes.length * 4)
            indexes.push(offset)
            if (offset >= data.length) return
          }
        }
      }) 
    }
  }
}

function noop () {}

function readUInt64LE (buf, offset) {
  var a = buf.readUInt32LE(offset)
  var b = buf.readUInt32LE(offset + 4)
  return b * 4294967296 + a
}

function parseHeader (data) {
  var header = {}

  header.version = data.readUInt32LE(4)
  header.uuid = data.slice(8, 16).toString('hex')
  header.articleCount = data.readUInt32LE(24)
  header.clusterCount = data.readUInt32LE(28)
  header.urlPtrPos = readUInt64LE(data, 32)
  header.titlePtrPos = readUInt64LE(data, 40)
  header.clusterPtrPos = readUInt64LE(data, 48)
  header.mimeListPos = readUInt64LE(data, 56)
  header.mainPage = data.readUInt32LE(64)
  header.layoutPage = data.readUInt32LE(68)
  header.checksumPos = readUInt64LE(data, 72)

  return header
}

function parseDirectoryEntry (data, entry) {
  if (!entry) entry = {}
  if (data.length < 12) return null

  entry.mime = data.readUInt16LE(0)
  entry.namespace = data.toString('utf-8', 3, 4)
  entry.revision = data.readUInt32LE(4)

  var offset = 16

  if (entry.mime === 65535) {
    entry.redirect = data.readUInt32LE(8)
    offset = 12
  } else {
    if (data.length < 16) return null
    entry.cluster = data.readUInt32LE(8)
    entry.blob = data.readUInt32LE(12)
  }

  if (data.length < offset) return null

  var ui = Array.prototype.indexOf.call(data, 0, offset)
  if (ui === -1) return null

  var ti = Array.prototype.indexOf.call(data, 0, ui+1)
  if (ti === -1) return null

  entry.url = data.toString('utf-8', offset, ui)
  entry.title = data.toString('utf-8', ui+1, ti)

  return entry
}

function readDirectoryEntry (filename, file, header, entry, cb) {
  var ready = function (err) {
    if (err) return cb(err)

    var stream = fs.createReadStream(filename, {start: entry.offset})

    var data = null
    var result = null
    var parse = through(function (buf, enc, next) {
      data = data ? Buffer.concat([data, buf]) : buf
      result = parseDirectoryEntry(data, entry)
      if (!result) return next()
      stream.destroy()
    })
    
    pump(stream, parse, function (err) {
      cb(null, result)        
    })
  }

  if (entry.offset !== undefined) {
    ready()
    return
  }

  readOffset(file, header.urlPtrPos, entry, ready)
}

function readHeader (file, cb) {
  read(file, 0, 79, function  (err, header) {
    if (err) return cb(err)
    cb(null, parseHeader(header))
  })
}

function createOffsetStream (file, start, num, opts) {
  if (!opts) opts = {}

  if (opts.start) {
    start += opts.start * 8
    num -= opts.start
  }
  if (opts.end) {
    num -= opts.end - (opts.start || 0) + 1
  }
  
  var stream = fs.createReadStream(file, {start: start, end: start + 8 * num - 1})
  var i = 0

  var parse = through.obj(function (data, enc, cb) {
    if (data.length === 0) return cb(null)
    cb(null, {
      index: i++,
      offset: readUInt64LE(data, 0)
    })
  })

  return pump(stream, choppa(8), parse)
}

function createClusterPointerStream (file, header, opts) {
  return createOffsetStream(file, header.clusterPtrPos, header.clusterCount, opts)
}

function createEntryPointerStream (file, header, opts) {
  return createOffsetStream(file, header.urlPtrPos, header.articleCount, opts)
}

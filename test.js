var zim = require('./')
var fs = require('fs')
var ndjson = require('ndjson')
var through = require('through2')
var pump = require('pump')
var test = require('tape')
var crypto = require('crypto')

var filename = './wikipedia_ay_all_nopic_2017-03.zim'
var expectedHeader = { 
  articleCount: 4587,
  checksumPos: 1772946,
  clusterCount: 12,
  clusterPtrPos: 329189,
  layoutPage: 4294967295,
  mainPage: 2435,
  mimeListPos: 80,
  titlePtrPos: 36864,
  urlPtrPos: 168,
  uuid: 'a858789b83af104f',
  version: 5
}

test('read header', function (t) {
  fs.open(filename, 'r', function (err, file) {
    if (err) t.ifErr(err)
    zim.readHeader(file, function(err, header) {
      if (err) t.ifErr(err)
      t.deepEquals(header, expectedHeader, 'headers match')
      t.end()
    })
  })
})

test('read entry pointer', function (t) {
  fs.open(filename, 'r', function (err, file) {
    if (err) t.ifErr(err)
    zim.readHeader(file, function(err, header) {
      if (err) t.ifErr(err)
      var pointers = zim.createEntryPointerStream(filename, header)
      pointers.once('data', function (pointer) {
        t.deepEquals(pointer, { index: 0, offset: 55212 }, 'first pointer matches')
        pointers.destroy()
        t.end()
      })
    })
  })
})

test('read entry metadata', function (t) {
  fs.open(filename, 'r', function (err, file) {
    if (err) t.ifErr(err)
    zim.readHeader(file, function(err, header) {
      if (err) t.ifErr(err)
      zim.readDirectoryEntry(filename, file, header, {index: 1}, function (err, entry) {
        if (err) t.ifErr(err)
        var expected = {
          blob: 472,
          cluster: 9,
          index: 1,
          mime: 0,
          namespace: '-',
          offset: 55233,
          revision: 0,
          title: '',
          url: 'j/body.js'
        }
        t.deepEquals(entry, expected, 'first entry matches')
        t.end()
      })
    })
  })
})

test('read cluster data', function (t) {
  fs.open(filename, 'r', function (err, file) {
    if (err) t.ifErr(err)
    zim.readHeader(file, function(err, header) {
      if (err) t.ifErr(err)
      zim.readDirectoryEntry(filename, file, header, {index: 1}, function (err, entry) {
        if (err) t.ifErr(err)
        zim.readCluster(filename, file, header, {index: entry.cluster}, function (err, cluster) {
          if (err) t.ifErr(err)
          var contents = cluster.blobs[entry.blob].toString()
          var hash = crypto.createHash('sha256').update(contents).digest('hex')
          var expected = 'e82d7f7f7e66ae9437867777001e10762aad939db279ec5af1cee5b7ccad8de9'
          t.equals(hash, expected, 'contents match')
          t.end()
        })
      })
    })
  })
})

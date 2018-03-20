const fs = require("fs");

const micro = require("micro");
const axios = require("axios");
const pify = require("pify");
const glob = pify(require("glob"));
const marked = require("marked");
const fm = require("front-matter");
const { resolve } = require("path");
const readFile = pify(fs.readFile);
const stat = pify(fs.stat);
const renameFile = fs.renameFile;
const send = micro.send;
const _ = require("lodash");
const compress = require("micro-compress");

function slugifyPath(path) {
  return encodeURI("/" + path.replace(/\.[^/.]+$/, ""));
}

const renderer = new marked.Renderer();
marked.setOptions({ renderer });

function sortByDate(df, dir = "desc") {
  return _.orderBy(df, ["attrs.created"], dir);
}

let _DOC_FILES_ = {};
let _SORTED_POSTS_ = [];
let _TAGS_ = {};

async function getFiles(cwd) {
  console.log("Building files...");
  cwd = cwd || process.cwd();
  let docPaths = await glob("posts/*.md", {
    cwd: cwd,
    ignore: "node_modules/**/*",
    nodir: true
  });

  let promises = [];
  let tmpDocFiles = {};
  docPaths.forEach(path => {
    let promise = getDocFile(path, cwd);
    promise.then(file => {
      tmpDocFiles[path] = file;
    });
    promises.push(promise);
  });
  await Promise.all(promises);
  _TAGS_ = {};
  _DOC_FILES_ = tmpDocFiles;
  _SORTED_POSTS_ = sortByDate(_DOC_FILES_);

  let tmpTags = [];
  // Get all tags
  _SORTED_POSTS_.map(function(post) {
    if (post.attrs.tags) {
      post.attrs.tags.map(function(tag) {
        // tmpTags.push(tag);
        _TAGS_[tag] = [];
      });
    }
  });
  // DeDupe tags
  tmpTags = tmpTags.reduce((x, y) => (x.includes(y) ? x : [...x, y]), []);
  // Add post slugs to tag list
  for (var tag in _TAGS_) {
    _SORTED_POSTS_.map(function(post) {
      if (post.attrs.tags) {
        post.attrs.tags.map(function(targetTag) {
          if (targetTag === tag) {
            _TAGS_[tag].push({ slug: encodeURI(post.path) });
          }
        });
      }
    });
  }
}

async function getDocFile(path, cwd) {
  cwd = cwd || process.cwd();
  let created;
  let filestats = await stat(path);
  let file = await readFile(resolve(cwd, path), "utf-8");

  file = fm(file);
  _DOC_FILES_[path] = {
    path: path,
    slug: slugifyPath(path),
    attrs: file.attributes,
    body: marked(file.body)
  };
  _DOC_FILES_[path].attrs.updated = filestats.mtime;

  _SORTED_POSTS_ = sortByDate(_DOC_FILES_);
  return _DOC_FILES_[path];
}

async function sortFiles() {
  let sorted = await _DOC_FILES_;
  return sorted;
}

// watch file changes
function watchFiles() {
  console.log("Watch files changes...");
  const options = {
    ignoreInitial: true,
    ignored: "node_modules/**/*"
  };
  const chokidar = require("chokidar");
  // Doc Pages
  chokidar
    .watch("*/**/*.md", options)
    .on("add", path => {
      getDocFile(path);
      console.log("File added: ", path);
    })
    .on("change", path => {
      getDocFile(path);
      console.log("File changed: ", path);
    })
    .on("unlink", path => {
      delete _DOC_FILES_[path];
      _SORTED_POSTS_ = sortByDate(_DOC_FILES_);
    });
}

const server = micro(
  compress(async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("X-Total-Posts", _SORTED_POSTS_.length);
    res.setHeader("X-Total-Tags", _.size(_TAGS_));

    if (req.url === "/posts") {
      return send(res, 200, _SORTED_POSTS_);
    }

    if (req.url === "/tags") {
      return send(res, 200, [_TAGS_]);
    }

    if (req.url.indexOf("/posts") === 0) {
      let path = decodeURI(req.url.slice(1) + ".md");
      if (!_DOC_FILES_[path]) {
        return send(res, 404, "File not found");
      }
      send(res, 200, [_DOC_FILES_[path]]);
    }
  })
);

module.exports = getFiles()
  .then(sortFiles())
  .then(() => {
    watchFiles();
    const port = process.env.PORT || 4000;
    server.listen(port);
    console.log(`Server listening on localhost:${port}`);
    return server;
  });

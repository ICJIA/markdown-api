const fs = require("fs");

const micro = require("micro");
const axios = require("axios");
const pify = require("pify");
const glob = pify(require("glob"));
const marked = require("marked");
const fm = require("front-matter");
const { resolve } = require("path");
const readFile = pify(fs.readFile);
const renameFile = fs.renameFile;
const send = micro.send;
const _ = require("lodash");

function slugifyPath(path, itemType) {
  return encodeURI("/" + path.replace(/\.[^/.]+$/, ""));
}

const renderer = new marked.Renderer();
marked.setOptions({ renderer });

function sortByDate(df, dir = "desc") {
  return _.orderBy(df, ["attrs.created"], dir);
}

let _DOC_FILES_ = {};
let _SORTED_POSTS_ = [];

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

  _DOC_FILES_ = tmpDocFiles;
  _SORTED_POSTS_ = sortByDate(_DOC_FILES_);
}

async function getDocFile(path, cwd) {
  cwd = cwd || process.cwd();

  let file = await readFile(resolve(cwd, path), "utf-8");
  // transform markdown to html

  file = fm(file);
  _DOC_FILES_[path] = {
    path: path,
    slug: slugifyPath(path, "posts"),
    attrs: file.attributes,
    body: marked(file.body)
  };
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
    })
    .on("change", path => getDocFile(path))
    .on("unlink", path => {
      delete _DOC_FILES_[path];
      _SORTED_POSTS_ = sortByDate(_DOC_FILES_);
    });
}

const server = micro(async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.url === "/posts") {
    return send(res, 200, _SORTED_POSTS_);
  }

  if (req.url.indexOf("/posts") === 0) {
    let path = decodeURI(req.url.slice(1) + ".md");
    if (!_DOC_FILES_[path]) {
      return send(res, 404, "File not found");
    }
    send(res, 200, [_DOC_FILES_[path]]);
  }
});

module.exports = getFiles()
  .then(sortFiles())
  .then(() => {
    watchFiles();
    const port = process.env.PORT || 4000;
    server.listen(port);
    console.log(`Server listening on localhost:${port}`);
    return server;
  });

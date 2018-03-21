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

const renderer = new marked.Renderer();
marked.setOptions({ renderer });

let _DOC_FILES_ = {};
let _SORTED_POSTS_ = [];
let _TAGS_ = {};
let _CATEGORIES_ = {};

function slugifyPath(path) {
  return encodeURI("/" + path.replace(/\.[^/.]+$/, ""));
}

function sortByDate(df, dir = "desc") {
  return _.orderBy(df, ["attrs.created"], dir);
}

function generateCategories(df) {
  let sortedPosts = sortByDate(df);
  let categoryObj = {};
  sortedPosts.map(function(post) {
    if (post.attrs.category) {
      categoryObj[post.attrs.category] = [];
    }
  });
  for (var category in categoryObj) {
    sortedPosts.map(function(post) {
      if (post.attrs.category === category) {
        categoryObj[category].push({
          slug: encodeURI("/" + post.path.replace(/\.[^/.]+$/, ""))
        });
      }
    });
  }
  _CATEGORIES_ = categoryObj;
}

function generateTags(df) {
  let tagObj = {};
  let sortedPosts = sortByDate(df);
  let tmpTags = [];

  sortedPosts.map(function(post) {
    if (post.attrs.tags) {
      post.attrs.tags.map(function(tag) {
        tagObj[tag] = [];
      });
    }
  });

  for (var tag in tagObj) {
    sortedPosts.map(function(post) {
      if (post.attrs.tags) {
        post.attrs.tags.map(function(targetTag) {
          if (targetTag === tag) {
            tagObj[tag] = [];
            tagObj[tag].push({
              slug: encodeURI("/" + post.path.replace(/\.[^/.]+$/, ""))
            });
          }
        });
      }
    });
  }

  _TAGS_ = tagObj;
}

async function getFiles(cwd) {
  console.log("Building files...");
  cwd = cwd || process.cwd();
  let docPaths = await glob("*/*.md", {
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
  _SORTED_POSTS_ = await sortByDate(_DOC_FILES_);
  generateCategories(_DOC_FILES_);
  generateTags(_DOC_FILES_);
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
      getDocFile(path).then(function() {
        generateTags(_DOC_FILES_);
        generateCategories(_DOC_FILES_);
      });

      console.log("File added: ", path);
    })
    .on("change", path => {
      getDocFile(path).then(function() {
        generateTags(_DOC_FILES_);
        generateCategories(_DOC_FILES_);
      });

      console.log("File changed: ", path);
    })
    .on("unlink", path => {
      delete _DOC_FILES_[path];
      getFiles();
      console.log("Delete: ", path, _DOC_FILES_);
    });
}

const server = micro(
  compress(async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("X-Total-Posts", _SORTED_POSTS_.length);
    res.setHeader("X-Total-Tags", _.size(_TAGS_));
    res.setHeader("X-Total-Categories", _.size(_CATEGORIES_));

    if (req.url === "/tags") {
      return send(res, 200, [_TAGS_]);
    }

    if (req.url.indexOf("/tags") === 0) {
      let tag = req.url.split("/");
      decodedTag = decodeURI(tag[2]);
      let response = "";
      _TAGS_[decodedTag]
        ? (response = _TAGS_[decodedTag])
        : (response = "Tag not found");

      return send(res, 200, response);
    }

    if (req.url === "/posts") {
      return send(res, 200, _SORTED_POSTS_);
    }

    if (req.url.indexOf("/posts") === 0) {
      let path = decodeURI(req.url.slice(1) + ".md");
      return !_DOC_FILES_[path]
        ? send(res, 404, "File not found")
        : send(res, 200, [_DOC_FILES_[path]]);
    }

    if (req.url === "/categories") {
      return send(res, 200, [_CATEGORIES_]);
    }

    if (req.url.indexOf("/categories") === 0) {
      let category = req.url.split("/");
      decodedCategory = decodeURI(category[2]);
      let response = "";
      _CATEGORIES_[decodedCategory]
        ? (response = _CATEGORIES_[decodedCategory])
        : (response = "Category not found");

      return send(res, 200, response);
    }
  })
);

module.exports = getFiles().then(() => {
  watchFiles();
  const port = process.env.PORT || 4000;
  server.listen(port);
  console.log(`Server listening on localhost:${port}`);
  return server;
});

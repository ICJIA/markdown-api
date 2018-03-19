const fs = require("fs");
const micro = require("micro");
const axios = require("axios");
const pify = require("pify");
const glob = pify(require("glob"));
const marked = require("marked");
const fm = require("front-matter");
const { resolve } = require("path");
const readFile = pify(fs.readFile);
const send = micro.send;
const _ = require("lodash");
const uuidv4 = require("uuid/v4");
const sluggo = require("sluggo");

function singular(str) {
  return str.slice(0, -1);
}

function slugifyPath(str, itemType) {
  return sluggo(
    str
      .split(itemType + "/")
      .pop()
      .replace(/\.[^/.]+$/, "")
  );
}

async function getHome() {
  let welcome = await readFile(resolve("./welcome.md", "."), "utf-8");
  home = marked(welcome);
}

async function sortContent(cwd, itemType) {
  if (itemType === "posts") {
    let sorted = await _.orderBy(posts, ["attrs.created"], "desc");
    posts = sorted;
  }

  if (itemType === "pages") {
    let sorted = await _.orderBy(pages, ["attrs.created"], "desc");
    pages = sorted;
  }
}

let posts = {};
let pages = {};
async function getContent(cwd, itemType) {
  console.log(`Building ${itemType}...`);
  cwd = cwd || process.cwd();
  let tmpPaths = await glob(itemType + "/*.md", {
    cwd: cwd,
    ignore: "node_modules/**/*",
    nodir: true
  });

  let promises = [];
  let tmpDocFiles = {};
  tmpPaths.forEach(path => {
    let promise = getDocFile(path, cwd, itemType);
    promise.then(file => {
      tmpDocFiles[path] = file;
    });
    promises.push(promise);
  });
  await Promise.all(promises);

  if (itemType === "posts") {
    let myArray = [];
    for (let post in tmpDocFiles) {
      myArray.push(tmpDocFiles[post]);
    }
    posts = myArray;
    sortContent("./", "posts");
  }
  if (itemType === "pages") {
    let myArray = [];
    for (let page in tmpDocFiles) {
      myArray.push(tmpDocFiles[page]);
    }
    pages = myArray;
    sortContent("./", "pages");
  }
}

async function getDocFile(path, cwd, itemType) {
  cwd = cwd || process.cwd();
  let file = await readFile(resolve(cwd, path), "utf-8");

  // transform markdown to html
  file = fm(file);
  if (itemType === "posts") {
    posts[path] = {
      path: path,
      slug: slugifyPath(path, itemType),
      attrs: file.attributes,
      body: marked(file.body)
    };
    console.log(posts[path]);
    return posts[path];
  }

  if (itemType === "pages") {
    pages[path] = {
      path: path,
      slug: slugifyPath(path, itemType),
      attrs: file.attributes,
      body: marked(file.body)
    };
    console.log(pages[path]);
    return pages[path];
  }
}

async function updatePosts(path, cwd, itemType) {
  cwd = cwd || process.cwd();
  let file = await readFile(resolve(cwd, path), "utf-8");
}

// watch file changes
function watchFiles() {
  console.log("Watch files changes...");
  const options = { ignoreInitial: true, ignored: "node_modules/**/*" };
  const chokidar = require("chokidar");
  // Post watcher
  chokidar
    .watch("posts/*.md", options)
    .on("add", path => {
      getDocFile(path, "./", "posts");
      console.log("Post added: ", path);
    })
    .on("change", path => {
      getDocFile(path, "./", "posts");
      console.log("Post changed: ", path);
    })
    .on("unlink", path => {
      delete posts[path];
      console.log(posts[path]);
      console.log("Post deleted: ", path);
    });
  // Pages watcher
  chokidar
    .watch("pages/*.md", options)
    .on("add", path => {
      getDocFile(path, "./", "pages");
      console.log("Page added: ", path);
    })
    .on("change", path => {
      let found = posts.find(function(el) {
        return el.path === path;
      });

      getDocFile(path, "./", "pages");

      console.log("Page changed: ", found);
    })
    .on("unlink", path => {
      //delete pages[path];
      let found = posts.find(function(el) {
        return el.path === path;
      });
      console.log("Page deleted: ", found);
    });
}

const server = micro(async function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  let path = req.url.slice(1) + ".md";
  if (req.url === "/") {
    return send(res, 200, home);
  }

  if (req.url === "/posts") {
    return send(res, 200, posts);
  }

  if (req.url === "/pages") {
    return send(res, 200, pages);
  }

  if (req.url.indexOf("/pages") === 0) {
    var found = pages.find(function(el) {
      return el.path === path;
    });

    if (!found) {
      return send(res, 404, "File not found");
    }
    let foundArray = [];
    foundArray.push(found);
    send(res, 200, foundArray);
  }

  if (req.url.indexOf("/posts") === 0) {
    var found = posts.find(function(el) {
      return el.path === path;
    });

    if (!found) {
      return send(res, 404, "File not found");
    }

    let foundArray = [];
    foundArray.push(found);
    send(res, 200, foundArray);
  }
});

module.exports = getContent("./", "posts")
  .then(() => getContent("./", "pages"))
  //   .then(() => sortContent("./", "posts"))
  //   .then(() => sortContent("./", "pages"))
  .then(() => getHome())
  .then(() => watchFiles())
  .then(() => {
    const port = process.env.PORT || 4000;
    server.listen(port);

    console.log(`Server listening on localhost:${port}`);
    return server;
  });

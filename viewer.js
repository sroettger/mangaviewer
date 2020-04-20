const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const vision = require('@google-cloud/vision');

const hostname = '127.0.0.1';
const port = 8000;

async function getDirsRecursive(dir) {
  const dirs = (await fs.readdir(dir, { withFileTypes: true }))
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(dir, dirent.name));

  let subdirs = [];
  for (let dir of dirs) {
    subdirs = subdirs.concat(await getDirsRecursive(dir));
  }

  return dirs.concat(subdirs);
}

async function getMangaDirs() {
  return (await getDirsRecursive("manga")).map(dirname => dirname.slice(6));
}

function getMangaPath(file) {
  if (path.isAbsolute(file) || file.includes('..')) {
    throw new Error('invalid path');
  }
  return path.join("manga", file)
}

async function handleDir(req, res, url) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const params = new URLSearchParams(url.search);
  let dir = params.get('path')
  let manga_dir = getMangaPath(dir);

  const files = (await fs.readdir(manga_dir, { withFileTypes: true }))
    .filter(dirent => !dirent.isDirectory())
    .map(dirent => path.join(dir, dirent.name));

  for (let file of files) {
    res.write(`<a href="/view?path=${encodeURIComponent(file)}">${file}</a><br/>`)
  }

  res.end();
}

async function handleIndex(req, res, url) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  let mangadirs = await getMangaDirs();

  for (let mangadir of mangadirs) {
    res.write(`<a href="/dir?path=${encodeURIComponent(mangadir)}">${mangadir}</a><br/>`)
  }

  res.end();
}

async function handleImg(req, res, url) {
  const params = new URLSearchParams(url.search);
  let file = getMangaPath(params.get('path'));
  const data = await fs.readFile(file);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/jpeg');
  res.end(data);
}

function getAnnotationPath(file) {
  if (!file.startsWith('manga/')) throw `path is not under manga: ${file}`;
  return 'annotations' + file.slice('manga'.length);
}

async function getLocalAnnotations(file) {
  let annotationPath = getAnnotationPath(file);
  try {
    return JSON.parse(await fs.readFile(annotationPath, 'utf-8'));
  } catch (e) {
    return undefined;
  }
}

async function getRemoteAnnotations(file) {
  const [result] = await client.documentTextDetection(file);
  let annotationPath = getAnnotationPath(file);
  await fs.mkdir(path.dirname(annotationPath), {recursive: true});
  await fs.writeFile(annotationPath, JSON.stringify(result))
  return result;
}

async function handleAnnotation(req, res, url) {
  const params = new URLSearchParams(url.search);
  let file = getMangaPath(params.get('path'));
  let result = await getLocalAnnotations(file);
  if (!result) {
    result = await getRemoteAnnotations(file);
  }

  let annotations = [];
  for (let annotation of result.textAnnotations) {
    annotations.push({text: annotation.description, boundingBox: annotation.boundingPoly.vertices})
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(annotations));
}

async function handleNextFile(req, res, url) {
  const params = new URLSearchParams(url.search);
  const file = params.get('path');
  const manga_file = getMangaPath(file);
  const manga_dir = path.dirname(manga_file);
  const dir = path.dirname(file);
  const basename = path.basename(file);

  const files = (await fs.readdir(manga_dir, { withFileTypes: true }))
    .filter(dirent => !dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();

  for (let i = 0; i < files.length; i++) {
    if (files[i] == basename) {
      let nextFile = path.join(dir, files[(i + 1) % files.length]);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(nextFile);
      return;
    }
  }

  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/plain');
  res.end('error');
}

async function handlePrevFile(req, res, url) {
  const params = new URLSearchParams(url.search);
  const file = params.get('path');
  const manga_file = getMangaPath(file);
  const manga_dir = path.dirname(manga_file);
  const dir = path.dirname(file);
  const basename = path.basename(file);

  const files = (await fs.readdir(manga_dir, { withFileTypes: true }))
    .filter(dirent => !dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();

  for (let i = 0; i < files.length; i++) {
    if (files[i] == basename) {
      let prevFile = path.join(dir, files[((i - 1) + files.length) % files.length]);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(prevFile);
      return;
    }
  }

  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/plain');
  res.end('error');
}

const view_html = fs.readFile("view.html");

async function handleView(req, res, url) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await view_html);
}

const server = http.createServer((req, res) => {
  let url = new URL(req.url, `http://${hostname}:${port}`);
  if (url.pathname == '/') {
    handleIndex(req, res, url);
  } else if (url.pathname == '/view') {
    handleView(req, res, url);
  } else if (url.pathname == '/dir') {
    handleDir(req, res, url);
  } else if (url.pathname == '/img') {
    handleImg(req, res, url);
  } else if (url.pathname == '/annotation') {
    handleAnnotation(req, res, url);
  } else if (url.pathname == '/nextfile') {
    handleNextFile(req, res, url);
  } else if (url.pathname == '/prevfile') {
    handlePrevFile(req, res, url);
  } else {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('not found');
  }
});

const client = new vision.ImageAnnotatorClient();

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

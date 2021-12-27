import path from 'path';
import express from 'express';

import args from './args.js';
import {MAX_HIGHLIGHTABLE_LENGTH, DEBUG, say, sleep, APP_ROOT} from './common.js';
import Archivist from './archivist.js';
import {highlight} from './highlighter.js';

const SITE_PATH = path.resolve(APP_ROOT, '..', 'public');

const app = express();

let running = false;
let Server, upAt, port;

const LibraryServer = {
  start, stop
}

export default LibraryServer;

async function start({server_port}) {
  if ( running ) {
    DEBUG && console.warn(`Attempting to start server when it is not closed. Exiting start()...`);
    return;
  }
  running = true;
  try {
    port = server_port;
    addHandlers();
    Server = app.listen(Number(port), err => {
      if ( err ) { 
        running = false;
        throw err;
      } 
      upAt = new Date;
      say({server_up:{upAt,port}});
    });
  } catch(e) {
    running = false;
    DEBUG && console.error(`Error starting server`, e);
  }
}

function addHandlers() {
  app.use(express.urlencoded({extended:true}));
  app.use(express.static(SITE_PATH));

  if ( args.library_path() ) {
    app.use("/library", express.static(args.library_path()))
  }

  app.get('/search(.json)?', async (req, res) => {
    await Archivist.isReady();
    const {query, results:resultIds, HL} = await Archivist.search(req.query.query);
    const results = resultIds.map(docId => Archivist.getDetails(docId));
    if ( req.path.endsWith('.json') ) {
      res.end(JSON.stringify({
        results, query
      }, null, 2));
    } else {
      results.forEach(r => {
        r.snippet = '... ' + highlight(query, r.content, {maxLength:MAX_HIGHLIGHTABLE_LENGTH})
          .sort(({fragment:{offset:a}}, {fragment:{offset:b}}) => a-b)
          .map(hl => Archivist.findOffsets(query, hl.fragment.text))
          .join(' ... ');
      });
      res.end(SearchResultView({results, query, HL}));
    }
  });

  app.get('/mode', async (req, res) => {
    res.end(Archivist.getMode());
  });

  app.get('/archive_index.html', async (req, res) => {
    Archivist.saveIndex();
    const index = Archivist.getIndex();
    res.end(IndexView(index));
  });

  app.post('/mode', async (req, res) => {
    const {mode} = req.body;
    await Archivist.changeMode(mode);
    res.end(`Mode set to ${mode}`);
  });

  app.get('/base_path', async (req, res) => {
    res.end(args.getBasePath());
  });

  app.post('/base_path', async (req, res) => {
    const {base_path} = req.body;
    Archivist.beforePathChanged();
    const change = args.updateBasePath(base_path);

    if ( change ) {
      await Archivist.afterPathChanged();
      Server.close(async () => {
        running = false;
        console.log(`Server closed.`);
        console.log(`Waiting 50ms...`);
        await sleep(50);
        start({server_port:port});
        console.log(`Server restarting.`);
      });
      res.end(`Base path set to ${base_path} and saved to preferences. See console for progress. Server restarting...`);
    } else {
      res.end(`Base path not changed.`);
    }
  });
}

async function stop() {
  let resolve;
  const pr = new Promise(res => resolve = res);

  console.log(`Closing library server...`);

  Server.close(() => {
    console.log(`Library server closed.`);
    resolve();
  });

  return pr;
}

function IndexView(urls) {
  return `
    <!DOCTYPE html>
    <meta charset=utf-8>
    <title>Your HTML Library</title>
    <link rel=stylesheet href=/style.css>
    <header>
      <h1><a href=/>22120</a> &mdash; Archive Index</h1>
    </header>
    <form method=GET action=/search>
      <fieldset class=search>
        <legend>Search your archive</legend>
        <input class=search type=search name=query placeholder="search your library">
        <button>Search</button>
      </fieldset>
    </form>
    <ul>
    ${
      urls.map(([url,{title, id}]) => `
        <li>
          ${DEBUG ? id + ':' : ''} <a target=_blank href=${url}>${(title||url).slice(0, MAX_HEAD)}</a>
        </li>
      `).join('\n')
    }
    </ul>
  `
}

function SearchResultView({results, query, HL}) {
  return `
    <!DOCTYPE html>
    <meta charset=utf-8>
    <title>${query} - 22120 search results</title>
    <link rel=stylesheet href=/style.css>
    <header>
      <h1><a href=/>22120</a> &mdash; Search Results</h1>
    </header>
    <p>
    View <a href=/archive_index.html>your index</a>, or
    </p>
    <form method=GET action=/search>
      <fieldset class=search>
        <legend>Search again</legend>
        <input class=search type=search name=query placeholder="search your library" value="${query}">
        <button>Search</button>
      </fieldset>
    </form>
    <p>
      Showing results for <b>${query}</b>
    </p>
    <ol>
    ${
      results.map(({snippet, url,title,id}) => `
        <li>
          ${DEBUG ? id + ':' : ''} <a target=_blank href=${url}>${HL.get(id)?.title||title||url}</a>
          <br>
          <small class=url>${(HL.get(id)?.url||url)}</small>
          <p>${snippet}</p>
        </li>
      `).join('\n')
    }
    </ol>
  `
}

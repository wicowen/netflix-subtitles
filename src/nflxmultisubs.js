const console = require('./console');
const JSZip = require('jszip');
const kDefaultSettings = require('./default-settings');
const PlaybackRateController = require('./playback-rate-controller');

////////////////////////////////////////////////////////////////////////////////

console.log("HELLO FROM NMS");

// If Netflix 1080p is loaded, it disables the required Netlflix subs format.

window.__NMSManifests = [];

var JP_OLD_NMS = JSON.parse;

JSON.parse = function(data, reviver) {
  
    var parsed = JP_OLD_NMS(data, reviver);
  
    if(parsed && parsed.result && parsed.result.timedtexttracks) {

      console.log(`SAW MANIFEST ${parsed.result.movieId}`);

        if (!window.__NMSManifests.find(m => m.movieId === parsed.result.movieId)) {
          window.__NMSManifests.push(parsed.result);
          console.log(`CAUGHT MANIFEST ${parsed.result.movieId}`);
          console.log("Manifests: ");
          console.log(window.__NMSManifests);
        }

        // Returns straight away if not in /watch
        if(window.__NflxMultiSubs && window.__NflxMultiSubs.updateManifest) {
          window.__NflxMultiSubs.updateManifest();
        }
    }

    return parsed;
};

// This is to counter Netflix 1080p extension
var profilesToAdd = [
  "dfxp-ls-sdh",
  "simplesdh",
  "nflx-cmisc",
  "heaac-2-dash",
  "BIF240",
  "BIF320"
];

var JS_OLD_NMS = JSON.stringify;

JSON.stringify = function(data, replacer, space) {

if(data && data.params && data.params.showAllSubDubTracks !== undefined) {
    data.params.showAllSubDubTracks = true;

    if(data.params.profiles) {
      for(var i =0; i < profilesToAdd.length; i++) {
          if(!data.params.profiles.includes(profilesToAdd[i])) {
            data.params.profiles.push(profilesToAdd[i]);
          }
      }
    }
}

return JS_OLD_NMS(data, replacer, space);
};

window.__NMSLastMovieId = undefined;

var oldHREF = undefined;

setInterval(function() {
  if(window.location.href != oldHREF) {
    oldHREF = window.location.href;
    console.log('Hash changed, invalidating window.__NMSLastMovieId.');
    // Force a reload
    window.__NMSLastMovieId = undefined;
  }
}, 100);

setTimeout(function() {
    // Returns straight away if not in /watch
    if(window.__NflxMultiSubs && window.__NflxMultiSubs.updateManifest) {
      window.__NflxMultiSubs.updateManifest();
    }
}, 500);

// global states
let gSubtitles = [],
  gSubtitleMenu;
let gMsgPort, gRendererLoop;
let gVideoRatio = 1080 / 1920;
let gRenderOptions = Object.assign({}, kDefaultSettings);

////////////////////////////////////////////////////////////////////////////////

class SubtitleBase {
  constructor(languageDescription, language, url) {
    this.state = 'GENESIS';
    this.active = false;
    this.language = language;
    this.languageDescription = languageDescription;
    this.url = url;
    this.extentWidth = undefined;
    this.extentHeight = undefined;
    this.lines = undefined;
    this.lastRenderedIds = undefined;
  }

  activate(options) {
    return new Promise((resolve, reject) => {
      this.active = true;
      if (this.state === 'GENESIS') {
        this.state = 'LOADING';
        console.log(`Subtitle "${this.languageDescription}" downloading`);
        this._download().then(() => {
          this.state = 'READY';
          console.log(`Subtitle "${this.languageDescription}" loaded`);
          resolve(this);
        });
      }
    });
  }

  deactivate() {
    this.active = false;
  }

  render(seconds, options, forced) {
    if (!this.active || this.state !== 'READY' || !this.lines) return [];
    const lines = this.lines.filter(
      line => line.begin <= seconds && seconds <= line.end
    );
    const ids = lines
      .map(line => line.id)
      .sort()
      .toString();

    if (this.lastRenderedIds === ids && !forced) return null;
    this.lastRenderedIds = ids;
    return this._render(lines, options);
  }

  getExtent() {
    return [this.extentWidth, this.extentHeight];
  }

  setExtent(width, height) {
    [this.extentWidth, this.extentHeight] = [width, height];
  }

  _render(lines, options) {
    // implemented in derived class
  }

  _download() {
    // implemented in derived class
    return Promise.resolve();
  }
}

class DummySubtitle extends SubtitleBase {
  constructor() {
    super('Off');
  }

  activate() {
    this.active = true;
    return Promise.resolve();
  }
}

class TextSubtitle extends SubtitleBase {
  constructor(...args) {
    super(...args);
  }

  _download() {
    return new Promise((resolve, reject) => {
      fetch(this.url)
        .then(r => r.text())
        .then(xmlText => {
          const xml = new DOMParser().parseFromString(xmlText, 'text/xml');

          const LINE_SELECTOR = 'tt > body > div > p';
          const lines = [].map.call(
            xml.querySelectorAll(LINE_SELECTOR),
            (line, id) => {
              let text = '';
              let extractTextRecur = parentNode => {
                [].forEach.call(parentNode.childNodes, node => {
                  if (node.nodeType === Node.ELEMENT_NODE)
                    if (node.nodeName.toLowerCase() === 'br') text += ' ';
                    else extractTextRecur(node);
                  else if (node.nodeType === Node.TEXT_NODE)
                    text += node.nodeValue;
                });
              };
              extractTextRecur(line);

              // convert microseconds to seconds
              const begin = parseInt(line.getAttribute('begin')) / 10000000;
              const end = parseInt(line.getAttribute('end')) / 10000000;
              return { id, begin, end, text };
            }
          );

          this.lines = lines;
          resolve();
        });
    });
  }

  _render(lines, options) {
    // `em` as font size was not so good -- some other extensions change the em (?)
    // these magic numbers looks good on my screen XD
    const fontSize = Math.sqrt(this.extentWidth / 1600) * 28;

    const textContent = lines.map(line => line.text).join('\n');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttributeNS(null, 'text-anchor', 'middle');
    text.setAttributeNS(null, 'alignment-baseline', 'hanging');
    text.setAttributeNS(null, 'dominant-baseline', 'hanging'); // firefox
    text.setAttributeNS(null, 'paint-order', 'stroke');
    text.setAttributeNS(null, 'stroke', 'black');
    text.setAttributeNS(
      null,
      'stroke-width',
      `${1.0 * options.secondaryTextStroke}px`
    );
    text.setAttributeNS(null, 'x', this.extentWidth * 0.5);
    text.setAttributeNS(
      null,
      'y',
      this.extentHeight * (options.lowerBaselinePos + 0.01)
    );
    text.setAttributeNS(null, 'opacity', options.secondaryTextOpacity);
    text.style.fontSize = `${fontSize * options.secondaryTextScale}px`;
    text.style.fontFamily = 'Arial, Helvetica';
    text.style.fill = 'white';
    text.style.stroke = 'black';
    text.style.textShadow = '1px 1px 3px rgba(0,0,0,.4)';
    text.textContent = textContent;
    return [text];
  }
}

class ImageSubtitle extends SubtitleBase {
  constructor(...args) {
    super(...args);
    this.zip = undefined;
  }

  _download() {
    return new Promise((resolve, reject) => {
      const fetchP = fetch(this.url).then(r => r.blob());
      const unzipP = fetchP.then(zipBlob => new JSZip().loadAsync(zipBlob));
      unzipP.then(zip => {
        zip
          .file('manifest_ttml2.xml')
          .async('string')
          .then(xmlText => {
            const xml = new DOMParser().parseFromString(xmlText, 'text/xml');

            // dealing with `ns2:extent`, `ns3:extent`, ...
            const _getAttributeAnyNS = (domNode, attrName) => {
              const name = domNode.getAttributeNames().find(
                n =>
                  n
                    .split(':')
                    .pop()
                    .toLowerCase() === attrName
              );
              return domNode.getAttribute(name);
            };

            const extent = _getAttributeAnyNS(
              xml.querySelector('tt'),
              'extent'
            );
            [this.extentWidth, this.extentHeight] = extent
              .split(' ')
              .map(n => parseInt(n));

            const _ttmlTimeToSeconds = timestamp => {
              // e.g., _ttmlTimeToSeconds('00:00:06.005') -> 6.005
              const regex = /(\d+):(\d+):(\d+(?:\.\d+)?)/;
              const [hh, mm, sssss] = regex
                .exec(timestamp)
                .slice(1)
                .map(parseFloat);
              return hh * 3600 + mm * 60 + sssss;
            };

            const LINE_SELECTOR = 'tt > body > div';
            const lines = [].map.call(
              xml.querySelectorAll(LINE_SELECTOR),
              (line, id) => {
                const extentAttrName = line.getAttributeNames().find(
                  n =>
                    n
                      .split(':')
                      .pop()
                      .toLowerCase() === 'extent'
                );

                const [width, height] = _getAttributeAnyNS(line, 'extent')
                  .split(' ')
                  .map(n => parseInt(n));
                const [left, top] = _getAttributeAnyNS(line, 'origin')
                  .split(' ')
                  .map(n => parseInt(n));
                const imageName = line
                  .querySelector('image')
                  .getAttribute('src');
                const begin = _ttmlTimeToSeconds(line.getAttribute('begin'));
                const end = _ttmlTimeToSeconds(line.getAttribute('end'));
                return { id, width, height, top, left, imageName, begin, end };
              }
            );

            this.lines = lines;
            this.zip = zip;
            resolve();
          });
      });
    });
  }

  _render(lines, options) {
    const scale = options.secondaryImageScale;
    const centerLine = this.extentHeight * 0.5;
    const upperBaseline = this.extentHeight * options.upperBaselinePos;
    const lowerBaseline = this.extentHeight * options.lowerBaselinePos;
    return lines.map(line => {
      const img = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'image'
      );
      this.zip
        .file(line.imageName)
        .async('blob')
        .then(blob => {
          const { left, top, width, height } = line;
          const [newWidth, newHeight] = [width * scale, height * scale];
          const newLeft = left + 0.5 * (width - newWidth);
          const newTop = top <= centerLine ? upperBaseline : lowerBaseline;

          const src = URL.createObjectURL(blob);
          img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', src);
          img.setAttributeNS(null, 'width', newWidth);
          img.setAttributeNS(null, 'height', newHeight);
          img.setAttributeNS(null, 'x', newLeft);
          img.setAttributeNS(null, 'y', newTop);
          img.setAttributeNS(null, 'opacity', options.secondaryImageOpacity);
          img.addEventListener('load', () => {
            URL.revokeObjectURL(src);
          });
        });
      return img;
    });
  }
}

// -----------------------------------------------------------------------------

class SubtitleFactory {
  // track: manifest.timedtexttracks[...]
  static build(track) {
    // Image based subs are nflx-cmisc
    // Text based are dfxp-ls-sdh or simplesdh
    // const isImageBased = track.downloadables.some(d => d["nflx-cmisc"]);
    const isImageBased = track.ttDownloadables["nflx-cmisc"];
    //const isCaption = track.trackType === 'CLOSEDCAPTIONS';
    // fixme: check this is correct:
    const isCaption = track.rawTrackType === 'closedcaptions';
    // These were updated in the API chnage:
    const languageDescription = track.languageDescription + (isCaption ? ' [CC]' : '');
    const language = track.language;

    if (isImageBased) {
      return this._buildImageBased(track, languageDescription, language);
    }
    return this._buildTextBased(track, languageDescription, language);
  }

  static _buildImageBased(track, languageDescription, language) { 
    // const maxHeight = Math.max(...track.downloadables.map(d => d.pixHeight));
    const maxHeight = track.ttDownloadables["nflx-cmisc"].height;
    // const d = track.downloadables.find(d => d.pixHeight === maxHeight);
    // const url = d.urls[Object.keys(d.urls)[0]];
    const url = track.ttDownloadables["nflx-cmisc"].downloadUrls[Object.keys(track.ttDownloadables["nflx-cmisc"].downloadUrls)[0]];
    return new ImageSubtitle(languageDescription, language, url);
  }

  static _buildTextBased(track, languageDescription, language) {
    const targetProfile = 'dfxp-ls-sdh';
    // const d = track.downloadables.find(d => d.contentProfile === targetProfile);
    const d = track.ttDownloadables["dfxp-ls-sdh"];
    if (!d) {
      console.error(`Cannot find "${targetProfile}" for ${languageDescription}`);
      return null;
    }

    // const url = d.urls[Object.keys(d.urls)[0]];
    const url = track.ttDownloadables["dfxp-ls-sdh"].downloadUrls[Object.keys(track.ttDownloadables["dfxp-ls-sdh"].downloadUrls)[0]];

    return new TextSubtitle(languageDescription, language, url);
  }
}

// timedtexttracks: manifest.timedtexttracks
const buildSubtitleList = timedtexttracks => {
  const dummy = new DummySubtitle();
  dummy.activate();

  // sorted by language in alphabetical order (to align with official UI)
  const subs = timedtexttracks
    // .filter(t => !t.isNone)
    // I guess it's this now:
    // We don't want those tracks where t.isForcedNarrative == true or t.isNone == true
    .filter(t => ( !(t.isForcedNarrative || t.isNoneTrack) ) )
    .map(t => SubtitleFactory.build(t))
    // fixme: sorting order seems wrong
    .sort((a, b) => { a.languageDescription.localeCompare(b.languageDescription); });
  return [dummy].concat(subs);
};

////////////////////////////////////////////////////////////////////////////////

// generate message that leads to LLN extension
function getLlnTipText(){
  // check if message should be shown
  let currentTime = (new Date()).getTime();
  // get time lln message was last hidden from storage (or 0 if none)
  let hideLlnTime = parseInt(localStorage.getItem('hide-lln-in-menu') || 0);
  // if message was hidden more than 7 days ago, show it again
  if (currentTime > hideLlnTime + 1000 * 3600 * 24 * 7) {
      let lln_text = `Are you learning a language? Try our new extension for studying a language with Netflix`;
      let lln_translations = {
          fr: `Est-ce que vous apprenez une langue?  Essayez notre nouvelle extension pour étudier une langue avec Netflix`,
          es: `¿Está aprendiendo un idioma? Pruebe nuestra nueva extensión para estudiar un idioma con Netflix`,
          pt: `Você está aprendendo um idioma? Experimente nossa nova extensão para estudar um idioma com a Netflix`,
          it: `Stai studiando una lingua? Prova la nostra nuova estensione per studiare una lingua con Netflix`,
          pl: `Uczysz się języka? Wypróbuj nasze nowe rozszerzenie do nauki języka z Netflix`,
          tr: `Dil mi öğreniyorsunuz? Yepyeni Netlifx eklentimiz ile dil öğrenin`,
          th: `คุณกำลังศึกษาภาษาอยู่ใช่ไหม? ลอง Extension ใหม่ของเราเพื่อใช้เรียนรู้ภาษาควบคู่กับ Netflix`,
          ko: `언어를 공부하고 계신가요? 넷플릭스 영상들과 함께 언어를 공부하는 저희 익스텐션을 사용해보세요!`,
          ja: `外国語を学習していますか？Netflixの新しい言語学習機能をお試し下さい`,
          ru: `Вы изучаете язык? Попробуйте наше новое расширение для изучения языка с Netflix`,
          de: `Lernst du eine Sprache? Probieren Sie unsere neue Erweiterung zum Lernen einer Sprache mit Netflix aus`,
          hi: `क्या आप कोई भाषा सीख रहे हैं? नेटफ्लिक्स के साथ एक भाषा का अध्ययन करने के लिए हमारे नए विस्तार को आजमायें।`,
          hu: `Tanulsz valamilyen nyelven? Próbáld ki új bővítményünket, hogy a Netflix segítségével fejleszthesd tudásod!`,
          sr: `Učite jezike? Isprobajte našu novu ekstenziju za učenje jezika na Netflixu`,
          zh: `您在學習語言嗎？試試我們的新擴充套件和 Netflix 一起學語言。`
      };
      // get localized text
      if (window.navigator.language && window.navigator.language.length >= 2) {
          let lang = window.navigator.language.slice(0, 2);
          if (lln_translations.hasOwnProperty(lang)) {
              lln_text = lln_translations[lang];
          }
      }
      return `<li class="lln-tip">
          <a style="width: 100%;" href="https://chrome.google.com/webstore/detail/language-learning-with-ne/hoombieeljmmljlkjmnheibnpciblicm" target="_blank">`
          + lln_text +
          ` ↗</a>
      <a href="#" class="lln-tip-hide" title="Hide" 
  onclick="event.preventDefault(); localStorage.setItem('hide-lln-in-menu', (new Date()).getTime().toString()); this.parentNode.remove(); ">X</a>
          </li>`
  } else {
    // message shouldn't be shown. return empty string.
    return ``;
  }
}

////////////////////////////////////////////////////////////////////////////////

const SUBTITLE_LIST_CLASSNAME = 'nflxmultisubs-subtitle-list';
class SubtitleMenu {
  constructor() {
    this.elem = document.createElement('ul');
    this.elem.classList.add('track-list', 'structural', 'track-list-subtitles');
    this.elem.classList.add(SUBTITLE_LIST_CLASSNAME);
  }

  render() {
    const checkIcon = `<span class="video-controls-check">
      <svg class="svg-icon svg-icon-nfplayerCheck" focusable="false">
      <use filter="" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#nfplayerCheck"></use>
      </svg></span>`;

    const loadingIcon = `<span class="video-controls-check">
      <svg class="svg-icon svg-icon-nfplayerCheck" focusable="false" viewBox="0 -5 50 55">
          <path d="M 6 25 C6 21, 0 21, 0 25 C0 57, 49 59, 50 25 C50 50, 8 55, 6 25" stroke="transparent" fill="red">
            <animateTransform attributeType="xml" attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.9s" repeatCount="indefinite"/>
          </path>
      </svg></span>`;

    this.elem.innerHTML = `<li class="list-header">Secondary Subtitles</li>`;

    // add LLN extension message
    this.elem.innerHTML += getLlnTipText();

    gSubtitles.forEach((sub, id) => {
      let item = document.createElement('li');
      item.classList.add('track');
      if (sub.active) {
        const icon = sub.state === 'LOADING' ? loadingIcon : checkIcon;
        item.classList.add('selected');
        item.innerHTML = `${icon}${sub.languageDescription}`;
      } else {
        item.innerHTML = sub.languageDescription;
        item.addEventListener('click', () => {
          activateSubtitle(id);
        });
      }
      this.elem.appendChild(item);
    });
  }
}

// -----------------------------------------------------------------------------

const isPopupMenuElement = node => {
  return (
    node.nodeName.toLowerCase() === 'div' &&
    node.classList.contains('audio-subtitle-controller')
  );
};

// FIXME: can we disconnect this observer once our menu is injected ?
// we still don't know whether Netflix would re-build the pop-up menu after
// switching to next episodes
const bodyObserver = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (isPopupMenuElement(node)) {
        // popup menu attached
        if (!node.getElementsByClassName(SUBTITLE_LIST_CLASSNAME).length) {
          if (!gSubtitleMenu) {
            gSubtitleMenu = new SubtitleMenu();
            gSubtitleMenu.render();
          }
          node.appendChild(gSubtitleMenu.elem);
        }
      }
    });
    mutation.removedNodes.forEach(node => {
      if (isPopupMenuElement(node)) {
        // popup menu detached
      }
    });
  });
});
const observerOptions = {
  attributes: true,
  subtree: true,
  childList: true,
  characterData: true
};
bodyObserver.observe(document.body, observerOptions);

////////////////////////////////////////////////////////////////////////////////

activateSubtitle = id => {
  const sub = gSubtitles[id];
  if (sub) {
    gSubtitles.forEach(sub => sub.deactivate());
    sub.activate().then(() => gSubtitleMenu && gSubtitleMenu.render());
  }
  gSubtitleMenu && gSubtitleMenu.render();
};

const buildSecondarySubtitleElement = options => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('nflxmultisubs-subtitle-svg');
  svg.style =
    'position:absolute; width:100%; top:0; bottom:0; left:0; right:0;';
  svg.setAttributeNS(null, 'width', '100%');
  svg.setAttributeNS(null, 'height', '100%');

  const padding = document.createElement('div');
  padding.classList.add('nflxmultisubs-subtitle-padding');
  padding.style = `display:block; content:' '; width:100%; padding-top:${gVideoRatio *
    100}%;`;

  const container = document.createElement('div');
  container.classList.add('nflxmultisubs-subtitle-container');
  container.style = 'position:relative; width:100%; max-height:100%;';
  container.appendChild(svg);
  container.appendChild(padding);

  const wrapper = document.createElement('div');
  wrapper.classList.add('nflxmultisubs-subtitle-wrapper');
  wrapper.style =
    'position:absolute; top:0; left:0; width:100%; height:100%; z-index:2; display:flex; align-items:center;';
  wrapper.appendChild(container);
  return wrapper;
};

// -----------------------------------------------------------------------------

class PrimaryImageTransformer {
  constructor() {}

  transform(svgElem, controlsActive, forced) {
    const selector = forced ? 'image' : 'image:not(.nflxmultisubs-scaled)';
    const images = svgElem.querySelectorAll(selector);
    if (images.length > 0) {
      const viewBox = svgElem.getAttributeNS(null, 'viewBox');
      const [extentWidth, extentHeight] = viewBox
        .split(' ')
        .slice(-2)
        .map(n => parseInt(n));

      // TODO: if there's no secondary subtitle, center the primary on baseline
      const options = gRenderOptions;
      const centerLine = extentHeight * 0.5;
      const upperBaseline = extentHeight * options.upperBaselinePos;
      const lowerBaseline = extentHeight * options.lowerBaselinePos;
      const scale = options.primaryImageScale;
      const opacity = options.primaryImageOpacity;

      [].forEach.call(images, img => {
        img.classList.add('nflxmultisubs-scaled');
        const left = parseInt(
          img.getAttributeNS(null, 'data-orig-x') ||
            img.getAttributeNS(null, 'x')
        );
        const top = parseInt(
          img.getAttributeNS(null, 'data-orig-y') ||
            img.getAttributeNS(null, 'y')
        );
        const width = parseInt(
          img.getAttributeNS(null, 'data-orig-width') ||
            img.getAttributeNS(null, 'width')
        );
        const height = parseInt(
          img.getAttributeNS(null, 'data-orig-height') ||
            img.getAttributeNS(null, 'height')
        );

        const attribs = [
          ['x', left],
          ['y', top],
          ['width', width],
          ['height', height]
        ];
        attribs.forEach(p => {
          const attrName = `data-orig-${p[0]}`,
            attrValue = p[1];
          if (!img.getAttributeNS(null, attrName)) {
            img.setAttributeNS(null, attrName, attrValue);
          }
        });

        const [newWidth, newHeight] = [width * scale, height * scale];
        const newLeft = left + 0.5 * (width - newWidth);
        const newTop =
          top <= centerLine
            ? upperBaseline - newHeight
            : lowerBaseline - newHeight;
        img.setAttributeNS(null, 'width', newWidth);
        img.setAttributeNS(null, 'height', newHeight);
        img.setAttributeNS(null, 'x', newLeft);
        img.setAttributeNS(null, 'y', newTop);
        img.setAttributeNS(null, 'opacity', opacity);
      });
    }
  }
}

class PrimaryTextTransformer {
  constructor() {
    this.lastScaledPrimaryTextContent = undefined;
  }

  transform(divElem, controlsActive, forced) {
    let parentNode = divElem.parentNode;
    if (!parentNode.classList.contains('nflxmultisubs-primary-wrapper')) {
      // let's use `<style>` + `!imporant` to outrun the offical player...
      const wrapper = document.createElement('div');
      wrapper.classList.add('nflxmultisubs-primary-wrapper');
      wrapper.style =
        'position:absolute; width:100%; height:100%; top:0; left:0;';

      const styleElem = document.createElement('style');
      wrapper.appendChild(styleElem);

      // wrap the offical text-based subtitle container, hehe!
      parentNode.insertBefore(wrapper, divElem);
      wrapper.appendChild(divElem);
      parentNode = wrapper;
    }

    const container = divElem.querySelector('.player-timedtext-text-container');
    if (!container) return;

    const textContent = container.textContent;
    if (this.lastScaledPrimaryTextContent === textContent && !forced) return;
    this.lastScaledPrimaryTextContent = textContent;

    const style = parentNode.querySelector('style');
    if (!style) return;

    const textSpan = container.querySelector('span');
    if (!textSpan) return;

    const fontSize = parseInt(textSpan.style.fontSize);
    if (!fontSize) return;

    const options = gRenderOptions;
    const opacity = options.primaryTextOpacity;
    const scale = options.primaryTextScale;
    const newFontSize = fontSize * scale;
    const styleText = `.player-timedtext-text-container span {
        font-size: ${newFontSize}px !important;
        opacity: ${opacity};
      }`;
    style.textContent = styleText;

    // const rect = divElem.getBoundingClientRect();
    // const [extentWidth, extentHeight] = [rect.width, rect.height];

    // const lowerBaseline = extentHeight * options.lowerBaselinePos;
    // const { left, top, width, height } = container.getBoundingClientRect();
    // const newLeft = extentWidth * 0.5 - width * 0.5;
    // let newTop = lowerBaseline - height;

    // CHANGED: sub position is now fixed

    style.textContent =
      styleText +
      '\n' +
      `
      .player-timedtext-text-container {
        bottom: 10% !important;
        top: auto !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
      }
      .player-timedtext-text-container + .player-timedtext-text-container {
        bottom: 4% !important;
      }
      `;
  }
}

class RendererLoop {
  constructor(video) {
    this.isRunning = false;
    this.isRenderDirty = undefined; // windows resize or config change, force re-render
    this.videoElem = video;
    this.subtitleWrapperElem = undefined; // secondary subtitles wrapper (outer)
    this.subSvg = undefined; // secondary subtitles container
    this.primaryImageTransformer = new PrimaryImageTransformer();
    this.primaryTextTransformer = new PrimaryTextTransformer();
  }

  setRenderDirty() {
    this.isRenderDirty = true;
  }

  start() {
    this.isRunning = true;
    window.requestAnimationFrame(this.loop.bind(this));
  }

  stop() {
    this.isRunning = false;
  }

  loop() {
    try {
      this._loop();
      this.isRunning && window.requestAnimationFrame(this.loop.bind(this));
    } catch (err) {
      console.error('Fatal: ', err);
    }
  }

  _loop() {
    const currentVideoElem = document.querySelector('#appMountPoint video');
    if (currentVideoElem && this.videoElem.src !== currentVideoElem.src) {
      // some video change episodes by update video src
      // force terminate renderer loop if src changed
      window.__NflxMultiSubs.rendererLoopDestroy();
      return;
    }

    // this script may be loaded while user's at the movie list page,
    // thus if there's no video playing, we can end the renderer loop
    if (!this.videoElem && !/netflix\.com\/watch/i.test(window.location.href)) {
      this._disconnect();
      this.stop();
      return;
    }

    const controlsActive = this._getControlsActive();
    // NOTE: don't do this, the render rate is too high to shown the
    // image in SVG for secondary subtitles.... O_Q
    // if (controlsActive) {
    //   this.setRenderDirty(); // to move up subttles
    // }
    if (!this._appendSubtitleWrapper()) {
      return;
    }

    this._adjustPrimarySubtitles(controlsActive, !!this.isRenderDirty);
    this._renderSecondarySubtitles();

    // render secondary subtitles
    // ---------------------------------------------------------------------
    this.subtitleWrapperElem.style.top = '0';

    // everything rendered, clear the dirty bit with ease
    this.isRenderDirty = false;
  }

  _disconnect() {
    // disconnect with background to make our icon grayscale again
    // FIXME: renderer loop shouldn't be responsible for this
    if (BROWSER === 'chrome') {
      if (gMsgPort && gMsgPort.disconnect()) gMsgPort = null;
    } else if (BROWSER === 'firefox') {
      window.postMessage(
        {
          namespace: 'nflxmultisubs',
          action: 'disconnect'
        },
        '*'
      );
    }
  }

  _getControlsActive() {
    // FIXME: better solution to handle different versions of Netflix web player UI
    // "Neo Style" refers to the newer version as in 2018/07
    let controlsElem = document.querySelector('.controls'),
      neoStyle = false;
    if (!controlsElem) {
      controlsElem = document.querySelector('.PlayerControlsNeo__layout');
      if (!controlsElem) {
        return false;
      }
      neoStyle = true;
    }
    // elevate the navs' z-index (to be on top of our subtitles)
    if (!controlsElem.style.zIndex) {
      controlsElem.style.zIndex = 3;
    }

    if (neoStyle) {
      return !controlsElem.classList.contains(
        'PlayerControlsNeo__layout--inactive'
      );
    }
    return controlsElem.classList.contains('active');
  }

  // @returns {boolean} Successed?
  _appendSubtitleWrapper() {
    if (!this.subtitleWrapperElem || !this.subtitleWrapperElem.parentNode) {
      const playerContainerElem = document.querySelector(
        '.nf-player-container'
      );
      if (!playerContainerElem) return false;
      this.subtitleWrapperElem = buildSecondarySubtitleElement(gRenderOptions);
      playerContainerElem.appendChild(this.subtitleWrapperElem);
    }
    return true;
  }

  // transform & scale primary subtitles
  _adjustPrimarySubtitles(active, dirty) {
    // NOTE: we cannot put `primaryImageSubSvg` into instance state,
    // because there are multiple instance of the SVG and they're switched
    // when the langauge of primary subtitles is switched.
    const primaryImageSubSvg = document.querySelector(
      '.image-based-timed-text svg'
    );
    if (primaryImageSubSvg) {
      this.primaryImageTransformer.transform(primaryImageSubSvg, active, dirty);
    }

    const primaryTextSubDiv = document.querySelector('.player-timedtext');
    if (primaryTextSubDiv) {
      this.primaryTextTransformer.transform(primaryTextSubDiv, active, dirty);
    }
  }

  _renderSecondarySubtitles() {
    if (!this.subSvg || !this.subSvg.parentNode) {
      this.subSvg = this.subtitleWrapperElem.querySelector('svg');
    }
    const seconds = this.videoElem.currentTime;
    const sub = gSubtitles.find(sub => sub.active);
    if (!sub) {
      return;
    }

    if (sub instanceof TextSubtitle) {
      const rect = this.videoElem.getBoundingClientRect();
      sub.setExtent(rect.width, rect.height);
    }

    const renderedElems = sub.render(
      seconds,
      gRenderOptions,
      !!this.isRenderDirty
    );
    if (renderedElems) {
      const [extentWidth, extentHeight] = sub.getExtent();
      if (extentWidth && extentHeight) {
        this.subSvg.setAttribute(
          'viewBox',
          `0 0 ${extentWidth} ${extentHeight}`
        );
      }
      [].forEach.call(this.subSvg.querySelectorAll('*'), elem =>
        elem.parentNode.removeChild(elem)
      );
      renderedElems.forEach(elem => this.subSvg.appendChild(elem));
    }
  }
}

window.addEventListener('resize', evt => {
  gRendererLoop && gRendererLoop.setRenderDirty();
  console.log(
    'Resize:',
    `${window.innerWidth}x${window.innerHeight} (${evt.timeStamp})`
  );
});

// -----------------------------------------------------------------------------

class NflxMultiSubsManager {
  constructor() {
    // this.lastMovieId = undefined;
    this.playerUrl = undefined;
    this.playerVersion = undefined;
    this.busyWaitTimeout = 100000; // ms

  }

  busyWaitVideoElement() {
    // Never reject
    return new Promise((resolve, _) => {
      let timer = 0;
      const intervalId = setInterval(() => {
        const video = document.querySelector('#appMountPoint video');
        if (video) {
          if (timer * 200 === this.busyWaitTimeout) {
            // Notify user can F5 or just keep wait...
          }
          clearInterval(intervalId);
          resolve(video);
        }
        timer += 1;
      }, 200);
    });
  }

  updateManifest() {

    const isInPlayerPage = /netflix\.com\/watch/i.test(window.location.href);
    if (!isInPlayerPage) {
      return;
    }

    // connect with background script
    // FIXME: should disconnect this port while there's no video playing, to gray out our icon;
    // However, we can't disconnect when <video> not found in the renderer loop,
    // because there's a small time gap between updateManifest() and <video> is initialize.
    if (BROWSER === 'chrome') {
      if (!gMsgPort) {
        try {
          const extensionId = window.__nflxMultiSubsExtId;
          gMsgPort = chrome.runtime.connect(extensionId);
          console.log(`Linked: ${extensionId}`);

          gMsgPort.onMessage.addListener(msg => {
            if (msg.settings) {
              gRenderOptions = Object.assign({}, msg.settings);
              gRendererLoop && gRendererLoop.setRenderDirty();
            }
          });
        } catch (err) {
          console.warn('Error: cannot talk to background,', err);
        }
      }
    } else {
      try {
        window.postMessage(
          {
            namespace: 'nflxmultisubs',
            action: 'connect'
          },
          '*'
        );
      } catch (err) {
        console.warn('Error: cannot talk to background,', err);
      }
    }

    // Sometime the movieId in URL may be different to the actually playing manifest
    // Thus we also need to check the player DOM tree...
    this.busyWaitVideoElement()
      .then(video => {
        try {
/*
          const movieIdInUrl = /^\/watch\/(\d+)/.exec(
            window.location.pathname
          )[1];

          console.log(`Note: movieIdInUrl=${movieIdInUrl}`);
          
          let playingManifest = manifest.movieId.toString() === movieIdInUrl;
*/

          // magic! ... div.VideoContainer > div#12345678 > video[src=blob:...]
          const movieIdInPlayerNode = video.parentNode.id;
          console.log(`Note: movieIdInPlayerNode=${movieIdInPlayerNode}`);

          const movieChanged = movieIdInPlayerNode !== window.__NMSLastMovieId;
          if (!movieChanged) {
            console.log(`updateManifest: Movie didn't change, returning. lastMovieId: ${window.__NMSLastMovieId}.`);
            return;
          }

          console.log(`updateManifest: Movie changed, setting up new stuff.`);

          const found = window.__NMSManifests.find(
            manifest => manifest.movieId.toString() === movieIdInPlayerNode
          );
          if (found) {
            console.log('Found required manifest.');
          } else {
            console.error("Didn't find required manifest.");
            return;
          }

          var manifest = found;

          // fixme: goes before or after?
          window.__NMSLastMovieId = movieIdInPlayerNode;
          gSubtitles = buildSubtitleList(manifest.timedtexttracks);

          gSubtitleMenu = new SubtitleMenu();
          gSubtitleMenu.render();

          // select subtitle to match the default audio track
          try { // 
            // const defaultAudioTrack = manifest.audioTracks.find(
            //   t => manifest.defaultMedia.indexOf(t.id) >= 0
            // );
            const defaultAudioTrack = manifest.audio_tracks.find(
              t => manifest.defaultTrackOrderList[0].audioTrackId === t.id);
            if (defaultAudioTrack) {
              const language = defaultAudioTrack.language;
              let autoSubtitleId = gSubtitles.findIndex(
                t => t.language === language && t.isCaption
              );
              autoSubtitleId =
                autoSubtitleId < 0
                  ? gSubtitles.findIndex(t => t.language === language)
                  : autoSubtitleId;
              if (autoSubtitleId >= 0) {
                console.log(`Subtitle "${language}" auto-enabled to match audio`);
                activateSubtitle(autoSubtitleId);
              }
            }
          } catch (err) {
            console.error('Default audio track not found, ', err);
          }

          // retrieve video ratio
          try {
            // let { width, height } = manifest.video_tracks[0].downloadables[0];
            // OK to use max values?
            let height = manifest.video_tracks[0].maxHeight;
            let width = manifest.video_tracks[0].maxWidth;
            gVideoRatio = height / width;
          } catch (err) {
            console.error('Video ratio not available, ', err);
          }
        } catch (err) {
          console.error('Fatal: ', err);
        }

        if (gRendererLoop) {
          // just for safety
          gRendererLoop.stop();
          gRendererLoop = null;
          console.log('Terminated: old renderer loop');
        }

        if (!gRendererLoop) {
          gRendererLoop = new RendererLoop(video);
          gRendererLoop.start();
          console.log('Started: renderer loop');
        }

        // detect for newer version of Netflix web player UI
        const hasNeoStyleControls = !!document.querySelector(
          '[class*=PlayerControlsNeo]'
        );
        console.log(`hasNeoStyleControls: ${hasNeoStyleControls}`);
      })
      .catch(err => {
        console.error('Fatal: ', err);
      });
  }

  rendererLoopDestroy() {
    const isInPlayerPage = /netflix\.com\/watch/i.test(window.location.href);
    if (!isInPlayerPage) return;

    this.updateManifest();
/*
    const manifestInUrl = /^\/watch\/(\d+)/.exec(window.location.pathname)[1];
    const found = window.__NMSManifests.find(
      manifest => manifest.movieId.toString() === manifestInUrl
    );
    if (found) {
      console.log('rendererLoop destroyed to prepare next episode.');
      this.updateManifest(found);
    } else {
      console.error('rendererLoop destroyed but no valid manifest.');
    }
*/
  }
}
window.__NflxMultiSubs = new NflxMultiSubsManager();

// =============================================================================

// Firefox: this injected agent cannot talk to extension directly, thus the
// connection (for applying settings) is relayed by our content script through
// window.postMessage().

if (BROWSER === 'firefox') {
  window.addEventListener(
    'message',
    evt => {
      if (!evt.data || evt.data.namespace !== 'nflxmultisubs') return;

      if (evt.data.action === 'apply-settings' && evt.data.settings) {
        gRenderOptions = Object.assign({}, evt.data.settings);
        gRendererLoop && gRendererLoop.setRenderDirty();
      }
    },
    false
  );
}

// =============================================================================

// control video playback rate
const playbackRateController = new PlaybackRateController();
playbackRateController.activate();

/**
 * 添加 keyboard event ，支援使用鍵盤數字鍵切換副字幕
 * 預設數字鍵 0 為關閉 副字幕
 * 副字幕順序由字幕列表選項上到下分配數字鍵 1 ~ 9
 * 48~57  為 英文字母上方數字鍵 keycode
 * 96~105 為 九宮格數字鍵 keycode
 */

window.addEventListener('keyup', e => {
  let keyCode =
    (e.keyCode >= 48 && e.keyCode <= 57) ||
    (e.keyCode >= 96 && e.keyCode <= 105)
      ? e.key
      : null;
  if (keyCode) {
    activateSubtitle(keyCode);
  }
});

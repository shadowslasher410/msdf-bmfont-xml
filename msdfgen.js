const opentype = require('opentype.js');
const exec = require('child_process').exec;
const mapLimit = require('map-limit');
const MultiBinPacker = require('multi-bin-packer');
const Canvas = require('canvas');

module.exports = function (fontPath) {
  const font = opentype.loadSync(fontPath);
  return generateBMFont;

  function generateBMFont (charset, fontSize, width, height, padding, callback) { // convert this to opts obj
    const canvas = new Canvas(width, height);
    const context = canvas.getContext('2d');
    const packer = new MultiBinPacker(width, height, padding);
    const chars = [];
    mapLimit(charset, 15, (char, cb) => {
      generateImage(char, fontSize, 'msdf', (err, res) => {
        if (err) return cb(err);
        cb(null, res);
      });
    }, (err, results) => {
      if (err) console.log(err);
      packer.addArray(results);
      const spritesheets = packer.bins.map((bin, index) => {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        // context.clearRect(0, 0, canvas.width, canvas.height);
        bin.rects.forEach(rect => {
          if (rect.data.imageData) {
            context.putImageData(rect.data.imageData, rect.x, rect.y);
          }
          const charData = rect.data.fontData;
          charData.x = rect.x;
          charData.y = rect.y;
          charData.page = index;
          chars.push(rect.data.fontData);
        });
        return canvas.toBuffer();
      });
      const os2 = font.tables.os2;
      const fontData = {
        pages: [],
        chars,
        info: {
          face: `${font.familyName} ${font.styleName}`,
          size: fontSize,
          bold: 0,
          italic: 0,
          charset,
          unicode: 1,
          stretchH: 100,
          smooth: 1,
          aa: 1,
          padding: [0, 0, 0, 0],
          spacing: [padding, padding]
        },
        common: {
          lineHeight: os2.sTypoAscender - os2.sTypoDescender + os2.sTypoLineGap,
          base: font.ascender * (fontSize / font.unitsPerEm),
          scaleW: width,
          scaleH: height,
          pages: packer.bins.length,
          packed: 0,
          alphaChnl: 0,
          redChnl: 0,
          greenChnl: 0,
          blueChnl: 0
        }
      };
      callback({spritesheets, fontData});
    });
  }

  function generateImage (char, fontSize, fieldType, callback) {
    const glyph = font.charToGlyph(char);
    const commands = glyph.getPath(0, 0, fontSize).commands;
    let contours = [];
    let currentContour = [];
    commands.forEach(command => {
      if (command.type === 'M') { // new contour
        if (currentContour.length > 0) {
          contours.push(currentContour);
          currentContour = [];
        }
      }
      currentContour.push(command);
    });
    contours.push(currentContour);

    let shapeDesc = '';
    contours.forEach(contour => {
      shapeDesc += '{';
      const lastIndex = contour.length - 1;
      contour.forEach((command, index) => {
        if (command.type === 'Z') {
          // shapeDesc += `${contour[0].x}, ${contour[0].y}`;
          // adding the last point breaks it??!??!
        } else {
          // make sure to invert y coordinates
          if (command.type === 'C') {
            shapeDesc += `(${command.x1}, ${command.y1}; ${command.x2}, ${command.y2}); `;
          } else if (command.type === 'Q') {
            shapeDesc += `(${command.x1}, ${command.y1}); `;
          }
          shapeDesc += `${command.x}, ${command.y}`;
        }
        if (index !== lastIndex) {
          shapeDesc += '; ';
        }
      });
      shapeDesc += '}';
    });

    if (contours.some(cont => cont.length === 1)) console.log('length is 1, failed to normalize glyph');
    const scale = fontSize / font.unitsPerEm;
    const pad = 5;
    let width = Math.round((glyph.xMax - glyph.xMin) * scale) + pad + pad;
    let height = Math.round((font.ascender - font.descender) * scale) + pad + pad;
    // let height = Math.round((glyph.yMax - glyph.yMin) * scale) + pad + pad;
    let command = `./msdfgen.osx ${fieldType} -format text -stdout -size ${width} ${height} -translate ${pad} ${font.ascender * scale} -pxrange 3 -defineshape "${shapeDesc}"`;
    // command += ` -testrender output/${char.charCodeAt(0)}-render.png ${width * 10} ${height * 10}`;
    exec(command, (err, stdout, stderr) => {
      if (err) callback(err);
      const rawImageData = stdout.match(/([0-9a-fA-F]+)/g).map(str => parseInt(str, 16)); // split on every number, parse
      const pixels = [];
      if (fieldType === 'sdf') {
        for (let i = 0; i < rawImageData.length; i++) {
          pixels.push(rawImageData[i], rawImageData[i], rawImageData[i], 255); // add 255 as alpha every 3 elements
        }
      } else if (fieldType === 'msdf') {
        for (let i = 0; i < rawImageData.length; i += 3) {
          pixels.push(...rawImageData.slice(i, i + 3), 255); // add 255 as alpha every 3 elements
        }
      }
      // if (((pixels.length / 4) / width) / height !== 1) {
      //   console.log('output error, image is wrong length');
      //   console.log('expected', width * height * 4, 'got', pixels.length);
      //   debugger;
      // }
      let imageData;
      try {
        imageData = new Canvas.ImageData(new Uint8ClampedArray(pixels), width, height);
      } catch (err) {
        console.log(`failed to generate image for character '${char}' (character code ${char.charCodeAt(0)})`);
        width = 0;
        height = 0;
      }
      const container = {
        data: {
          imageData,
          fontData: {
            id: char.charCodeAt(0),
            width, height,
            xoffset: 0,
            yoffset: 0,
            xadvance: glyph.advanceWidth * scale,
            chnl: 15
          }
        },
        width, height
      };
      callback(null, container);
    });
  }
};
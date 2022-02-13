#!/usr/bin/env node

const basePath = process.cwd();

const Fs = require('fs');
const Path = require('path');
const { promisify } = require('util');

const SETTINGS = require('./interpolator-settings.json');

const Readdir = promisify(Fs.readdir);
const ReadFile = promisify(Fs.readFile);
const WriteFile = promisify(Fs.writeFile);
const Access = promisify(Fs.access);
const Mkdir = promisify(Fs.mkdir);

const folder = process.argv[2]
  ? Path.join(basePath, process.argv[2])
  : basePath;

console.log(`>> RUNNING lightroom-interpolator on "${folder}"`);

/*
Returns an object where all the values are interpolatable values and the values of the file
*/
async function parseFile(filePath) {
  const file = await ReadFile(filePath);

  return String(file)
    .split('\n')
    .map((e) => e.trim())
    .reduce((acc, el) => {
      if (SETTINGS.crsToInterpolate.some((key) => el.includes(key))) {
        const [crs, valueStr] = el.split('=');

        const value = parseInt(
          valueStr.replaceAll(`"`, ``).replaceAll(`+`, ``),
          10
        );

        acc[crs] = value;
      }

      return acc;
    }, {});
}

/*
Adds + and - to all numbers, limits to two digits
*/
function stringifyValue(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(2)}`;
}

function patchFile(fileContent, newSettings) {
  const settingsKeys = Object.keys(newSettings);
  const file = fileContent;

  return file
    .split('\n')
    .map((e) => {
      if (settingsKeys.some((setting) => e.includes(setting))) {
        const leftSide = e.split('=')[0];
        const setting = leftSide.trim();
        return `${leftSide}="${stringifyValue(newSettings[setting])}"`;
      }
      return e;
    })
    .join('\n');
}

/*
Receives two objects with the same keys, returns an array of the keys in which objects differ
*/
function getDifferentKeys(obj1, obj2) {
  return Object.keys(obj1).filter((key) => {
    return obj1[key] !== obj2[key];
  });
}

function interpolateSettings(firstInterpolable, lastInterpolable, progress) {
  let res = {};

  for (const key in firstInterpolable) {
    const range = lastInterpolable[key] - firstInterpolable[key];
    res[key] = firstInterpolable[key] + range * progress;
  }

  return res;
}

async function main() {
  const files = await Readdir(folder);

  const xmpFiles = files
    .filter((fileName) => fileName.includes('.xmp'))
    .sort((a, b) => {
      return a.localeCompare(b);
    });

  if (xmpFiles.length < 3) {
    console.log(`Not enough .XMP files found on "${folder}"`);
    return;
  }

  const firstFileSettings = await parseFile(Path.join(folder, xmpFiles[0]));
  const lastFileSettings = await parseFile(
    Path.join(folder, xmpFiles[xmpFiles.length - 1])
  );

  const differentKeys = getDifferentKeys(firstFileSettings, lastFileSettings);

  const firstInterpolable = differentKeys.reduce((acc, key) => {
    acc[key] = firstFileSettings[key];
    return acc;
  }, {});
  const lastInterpolable = differentKeys.reduce((acc, key) => {
    acc[key] = lastFileSettings[key];
    return acc;
  }, {});

  try {
    await Mkdir(Path.join(folder, 'bak'));
  } catch (e) {}

  for (const i in xmpFiles) {
    const xmpFileName = xmpFiles[i];
    const fileContent = String(await ReadFile(Path.join(folder, xmpFileName)));
    const progress = i / (xmpFiles.length - 1);
    const newFileSettings = interpolateSettings(
      firstInterpolable,
      lastInterpolable,
      progress
    );

    const newFile = patchFile(fileContent, newFileSettings);

    try {
      await Access(Path.join(folder, 'bak', xmpFileName));
    } catch (e) {
      // no backup file exists, lets save it first
      if (e.code === 'ENOENT') {
        console.info(`>> BACKING UP "${xmpFileName}"`);
        await WriteFile(Path.join(folder, 'bak', xmpFileName), fileContent);
      }
    }

    console.info(`>> WRITING new settings to "${xmpFileName}"`);
    await WriteFile(Path.join(folder, xmpFileName), newFile);
  }
}

main();

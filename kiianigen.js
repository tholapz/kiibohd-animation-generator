/**
 * Usage:
 * node kiianigen.js {generator name} {ktype standard dir}
 *
 * The generator name can be any one of then names specified in the generator map, or can be "all",
 * in which case all the animations are created and output to the json file.
 *
 * The ktype standard dir is required. It can be at ../KType-Standard or a custom directory. This
 * directory should be the configuration dumped by the kiibohd configurator. This script uses the
 * kll.json file and the KType-Standard.json file written out by the configurator to get data about
 * what to use in the output json configuration.
 *
 * In addition, this script outputs the original KType-Standard.json file with the animations added
 * in, so if there are key changes that you made previously, they will be preserved (like remapping
 * alt/gui keys for mac os).
 *
 * The output file will be a json file into the json_out directory that will be named something like
 * KType-{date}-{time}-{generator name}.json.
 */

'use strict';

/* globals require, process, console */
var fs = require("fs");
var dateFormat = require('dateformat');

// Get the generator to be used.
var generator = process.argv[2].trim();

var maxRow = 0;
var maxCol = 0;
var json, leds, blankLeds, keyedLeds, kll;

/**
 * The main function for the script. This basically opens a few of the files from the
 * KType-Standard directory, builds the designated animations, and writes out a json config
 * file that can be imported into the kiibohd configurator.
 */
function main() {
    var i;

    // If the source KType-Standard directory is different from ../KType-Standard, then it must be
    // the secondary argument.
    var srcConfigDir = "../KType-Standard";
    if (process.argv.length > 3) {
        srcConfigDir = process.argv[3].trim();
    }

    // If no generator is provided, then bail out.
    if (!generator || (!generators[generator] && generator !== 'all')) {
        console.info("Unknown generator: ", generator);
        return;
    }

    // Get info about the current configuration files from KType-Standard directory.
    json = JSON.parse(require('fs')
                          .readFileSync(srcConfigDir + '/KType-Standard.json', 'utf8'));

    // The current animations
    var animOrig = json.animations;

    // Information about the leds
    leds = json.leds;
    blankLeds = [];
    keyedLeds = [];
    for (i = 0; i < leds.length; i++) {
        if (leds[i].scanCode) {
            keyedLeds.push(leds[i]);
        } else {
            blankLeds.push(leds[i]);
        }
    }

    // Get the max pixel rows and columns
    kll = JSON.parse(require('fs').readFileSync(srcConfigDir + '/kll.json', 'utf8'));
    for (var pxi in kll.PixelIds) {
        var px = kll.PixelIds[pxi];
        maxRow = Math.max(maxRow, px.Row);
        maxCol = Math.max(maxCol, px.Col);
    }


    if (generator === 'all') {
        for (var g in generators) {
            if (g.indexOf('!') === -1) {
                animOrig[g] = generators[g]();
            }
        }
    } else {
        animOrig[generator] = generators[generator]();
    }

    // Now set up the keys for triggering the animations. we set up the keys so that in layer 1,
    // each key turns on one animation and turns off all the rest. We also turn off the key for
    // layer 1, so that triggering the animation won't send key strokes to the foreground
    // application. If you want this stuff to happen on a different layer or with different
    // keys, change triggerLayer and keys below.
    var triggerLayer = "1";
    var keys = "QWERTYUIOPASDFGHJKLZXCVBNM";
    var triggerKeys = [];
    var matrix = json.matrix;

    for (i = 0; i < matrix.length; i++) {
        if (keys.indexOf(matrix[i].layers["0"].key) > -1) {
            triggerKeys[keys.indexOf(matrix[i].layers["0"].key)] = matrix[i];
        }
    }
    var animNames = Object.keys(animOrig);
    for (i = 0; i < animNames.length; i++) {
        var iKey = triggerKeys[i];

        // Turn off the key for layer 1
        iKey.layers[triggerLayer] = {
            "key": "#:None",
            "label": "NONE"
        };

        // Set the triggers for toggling off/on the animations
        iKey.triggers = {};
        iKey.triggers[triggerLayer] = [];
        for (var a = 0; a < animNames.length; a++) {
            var obj = {
                type: "animation",
                label: "",
                action: ""
            };
            var ss = (a === i) ? "start" : "stop";
            obj.label = ss + " '" + animNames[a] + "' animation";
            obj.action = "A[" + animNames[a] + "](" + ss + ")";
            iKey.triggers["1"].push(obj);
        }
    }


    // Change out some of the headers
    var theDate = new Date();
    json.header.Author = "intafon (ryan-todd-ryan) " + dateFormat(theDate, "yyyy");
    json.header.Date = dateFormat(theDate, "yyyy-mm-dd");
    json.header.Variant = "kiianigen_animations_" + generator;

    var newFileName = "KType-" + dateFormat(theDate, "yyyymmdd-HHMMss") + "-" + generator;
    console.info("newfilename", newFileName);

    var jsonOutDir = "./json_out";
    if (!fs.existsSync(jsonOutDir)){
        fs.mkdirSync(jsonOutDir);
    }
    fs.writeFileSync(jsonOutDir + '/' + newFileName + '.json', JSON.stringify(json, null, 4));

    console.info("move output to KType-Standard.json and run 'dfu-util " +
                 "-D kiibohd.dfu.bin' to flash keyboard");
}

/**
 * Generates a "pixel" value that is used in an animation frame.
 * @param  {String} row
 *         The row to use.
 * @param  {String/Number} col
 *         The column to use.
 * @param  {Number} r
 *         The red value 0-255.
 * @param  {Number} g
 *         The green value 0-255.
 * @param  {Number} b
 *         The blue value 0-255.
 * @param  {Number} pixelNumber
 *         The pixel id number to use. row and col must be null.
 * @return {String}
 *         A properly formatted pixel, such as "P[c:-2%](0,0,255)"
 */
var getPixel = function(row,col,r,g,b, pixelNumber) {
    var rc = [];
    var colors = [
        ((r) ? r : 0),
        ((g) ? g : 0),
        ((b) ? b : 0),
    ];
    if (row !== undefined && row !== null) {
        rc.push("r:" + row);
    }
    if (col !== undefined && col !== null) {
        rc.push("c:" + col);
    }
    if (pixelNumber !== undefined && pixelNumber !== null) {
        rc.push(pixelNumber);
    }
    return "P[" + rc.join(",") + "](" + colors.join(",") + ")";
    // return something like: P[c:-2%](0,0,255)
};

/**
 * Returns a color in between the origin color and the destination color, based on the number of
 * steps over which the color should bleed and the step number for which the returned value should
 * represent. If no steps or step is provided, then the function simply returns the color value
 * representing the average of the 2 colors. Color values are rounded to integer and clamped between
 * 0 and 255.
 *
 * @param  {Array} origColor
 *         The color from which to bleed, r,g,b array of color values.
 * @param  {Array} destColor
 *         The color to which to bleed, r,g,b array of color values.
 * @param  {Number} steps
 *         The number of linear steps over which the color should bleed. The minimum number of steps
 *         is 2. i.e. origin color (0), avg color (1), destination color (2)
 * @param  {Number} step
 *         The step index value for the return value.
 * @return {Array}
 *         An array of arrays of r,g,b color values representing the full bleed.
 */
var colorBleed = function(origColor, destColor, steps, step) {
    if (steps === undefined || steps < 2) {
        steps = 2;
        step = 1;
    }
    var i;
    var diffSteps = [];
    for (i = 0; i < origColor.length; i++) {
        var cDiff = destColor[i] - origColor[i];
        diffSteps[i] = cDiff / steps;
    }
    var colors = [];
    for (var s = 0; s <= steps; s++) {
        var color = [];
        for (i = 0; i < origColor.length; i++) {
            var iColor = Math.round(origColor[i] + (s * diffSteps[i]));
            iColor = Math.max(iColor, 0);
            iColor = Math.min(iColor, 255);
            color.push(iColor);
        }
        colors.push(color);
    }
    if (step !== undefined) {
        return colors[step];
    }
    return colors;
};

/**
 * Creates an array of color values representing a gradual fade between multiple colors. Usage:
 * var colorArray = multiColorBleed(30, [0,0,0], [255,255,255], [0,0,255]);
 *
 * @param  {Number} frameCountPerColor
 *         The number of frames used to get from one color to the next.
 * @param  ...args
 *         The colors that should be animated, as arrays of [r,g,b].
 * @return {Array}
 *         The array of colors.
 */
var multiColorBleed = function(frameCountPerColor) {
    var colorValues = Array.prototype.slice.call(arguments, 1);
    var colors = [];
    var i;
    for (i = 0; i < colorValues.length; i++) {
        var cOrig = colorValues[i];
        var cDest;
        if (i === colorValues.length - 1) {
            cDest = colorValues[0];
        } else {
            cDest = colorValues[i + 1];
        }
        var fade = colorBleed(cOrig, cDest, frameCountPerColor);
        if (i > 0) {
            fade = fade.slice(1);
        }
        colors = colors.concat(fade);
    }
    colors.pop();
    return colors;
};

/**
 * Creates an animation for pulsing between colors, using multiColorBleed to generate the array of
 * colors used in the animation frames. This pulses the entire keyboard.
 *
 * @param  {Number} frameCountPerColor
 *         The number of frames used to get from one color to the next.
 * @param ...args
 *        The colors that should be animated, as arrays of [r,g,b].
 * @return {Object}
 *         An animation object.
 */
function colorPulseGenerator(frameCountPerColor) {
    var args = Array.prototype.slice.call(arguments, 0);
    var colors = multiColorBleed.apply(null, args);

    var animation = {
        "settings": "framedelay:3, framestretch, loop, replace:all, pfunc:interp",
        "type": "animation",
        "frames": []
    };

    var frames = [];
    var frame, color;
    for (var i = 0; i < colors.length; i++) {
        frame = [];
        color = colors[i];
        frame.push(getPixel(null, "-1%", color[0], color[1], color[2]));
        frame.push(getPixel(null, "101%", color[0], color[1], color[2]));
        frames.push(frame.join(","));
    }
    animation.frames = frames;
    return animation;
}

// The generators are an object map of animation generators.
var generators = {

    /**
     * Blinks random keys.
     */
    "dodgyPixel": function() {
        var animation = {
            "settings": "framedelay:1, loop, replace:all",
            "type": "animation",
            "frames": []
        };
        var frames = [];
        var frame = [];
        for (var x = 0; x <= maxRow; x++) {
            for (var y = 0; y <= maxCol; y++) {
                frame.push(getPixel(x, y, 25, 25, 25));
            }
        }
        frames.push(frame.join(","));
        for (var i = 0; i < 50; i++) {
            var rx = Math.round(Math.random() * maxRow);
            var ry = Math.round(Math.random() * maxCol);
            frames.push(getPixel(rx, ry, 255, 255, 255));
            frames.push(getPixel(rx, ry, 25, 25, 25));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Makes your keyboard look vaguely like Kitt 200 from Knight Rider.
     */
    "kitt2000": function() {
        var animation = {
            "settings": "framedelay:3, framestretch, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };
        var bgColor = [0, 0, 0];
        var hiColor = [255, 26, 0];
        // Number of columns over which to bleed to bg color.
        var bleed = 5;
        var bleedColors = colorBleed(hiColor, bgColor, bleed);
        var lastBleedColor = colorBleed(hiColor, bgColor, bleed, bleed - 1);

        var frames = [];
        var steps = 50;
        var step = 100 / steps;
        var overflow = 1; //step
        var frame;
        var j;
        for (var i = -overflow; i < steps + overflow + 1; i++) {
            frame = [];
            frame.push(getPixel(null, -2 + "%", bgColor[0], bgColor[1], bgColor[2]));
            frame.push(getPixel(null, ((i - overflow - (bleed - 1)) * step) + "%", lastBleedColor[0], lastBleedColor[1], lastBleedColor[2]));
            frame.push(getPixel(null, ((i - overflow) * step) + "%", hiColor[0], hiColor[1], hiColor[2]));
            frame.push(getPixel(null, ((i - overflow + (bleed - 1)) * step) + "%", lastBleedColor[0], lastBleedColor[1], lastBleedColor[2]));
            frame.push(getPixel(null, 102 + "%", bgColor[0], bgColor[1], bgColor[2]));

            frames.push(frame.join(","));
        }
        for (i = steps + overflow + 1; i > -overflow - 1; i--) {
            frame = [];

            frame.push(getPixel(null, -2 + "%", bgColor[0], bgColor[1], bgColor[2]));
            frame.push(getPixel(null, ((i - overflow - (bleed - 1)) * step) + "%", lastBleedColor[0], lastBleedColor[1], lastBleedColor[2]));
            frame.push(getPixel(null, ((i - overflow) * step) + "%", hiColor[0], hiColor[1], hiColor[2]));
            frame.push(getPixel(null, ((i - overflow + (bleed - 1)) * step) + "%", lastBleedColor[0], lastBleedColor[1], lastBleedColor[2]));
            frame.push(getPixel(null, 102 + "%", bgColor[0], bgColor[1], bgColor[2]));

            frames.push(frame.join(","));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Failed attempt to get a kitt2000 animation that goes top to bottom... something is wrong with
     * it though...
     */
    "bluewipe": function(maxFrames) {
        var animation = {
            "settings": "framedelay:3, framestretch, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };
        var bgColor = [93, 93, 93];
        var hiColor = [0, 26, 255];
        // Number of columns over which to bleed to bg color.
        var bleed = 5;
        var bleedColors = colorBleed(hiColor, bgColor, bleed);
        var lastBleedColor = colorBleed(hiColor, bgColor, bleed, bleed - 1);

        var frames = [];
        var steps = 50;
        var step = 100 / steps;
        var overflow = 1;
        var frame;
        var j;
        for (var i = -overflow; i < steps + overflow + 1; i++) {
            frame = [];
            frame.push(getPixel(-2 + "%", null, bgColor[0], bgColor[1], bgColor[2]));
            frame.push(getPixel(((i - overflow) * step) + "%", null, hiColor[0], hiColor[1], hiColor[2]));
            frame.push(getPixel(102 + "%", null, bgColor[0], bgColor[1], bgColor[2]));

            frames.push(frame.join(","));
        }
        for (i = steps + overflow + 1; i > -overflow - 1; i--) {
            frame = [];
            frame.push(getPixel(-2 + "%", bgColor[0], null, bgColor[1], bgColor[2]));
            frame.push(getPixel(((i - overflow) * step) + "%", null, hiColor[0], hiColor[1], hiColor[2]));
            frame.push(getPixel(102 + "%", null, bgColor[0], bgColor[1], bgColor[2]));
            frames.push(frame.join(","));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Pulse the entire keyboard red.
     */
    "redPulse": function(maxFrames) {
        return colorPulseGenerator(240, [255, 25, 0], [0, 0, 0]);
    },

    /**
     * Pulse the entire keyboard blue to yellow.
     */
    "blueYellowPulse": function() {
        return colorPulseGenerator(240, [0, 0, 255], [255, 255, 0]);
    },

    /**
     * Pulse the entire keyboard red to green to blue.
     */
    "rgbPulse": function() {
        return colorPulseGenerator(120, [255, 0, 0],[0, 255, 0], [0, 0, 255]);
    },

    /**
     * Pulse the entire keyboard red to green to blue with white in between.
     */
    "rgbZebraPulse": function() {
        return colorPulseGenerator(120, [255, 0, 0], [255, 255, 255], [0, 255, 0], [255, 255, 255], [0, 0, 255], [255, 255, 255]);
    },

    /**
     * Animates the entire keyboard with TV static.
     */
    "whiteNoise": function(maxFrames) {
        var animation = {
            "settings": "framedelay:1, loop, replace:all",
            "type": "animation",
            "frames": []
        };
        console.info("whitenoise");
        var frames = [];
        if (!maxFrames) {
            maxFrames = 20;
        }
        var maxIntensity = 153;
        for (var f = 0; f < maxFrames; f++) {
            var frame = [];
            var stepsPer = 20;
            // TODO: swap out "119" for a value gotten from other json config files.
            for (var p = 1; p <= 119; p++) {
                var rIntensity = Math.floor(Math.random() * maxIntensity);
                var px = getPixel(null, null, rIntensity, rIntensity, rIntensity, p);
                frame.push(px);
            }
            frames.push(frame.join(","));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * An example using the led data to fill in the pixels for the base and the keys differently;
     * in this case, the base leds are green and the keys are blue.
     */
    "topAndBottom": function() {
        var animation = {
            "settings": "framedelay:1, loop, replace:all",
            "type": "animation",
            "frames": []
        };
        var frames = [];
        var frame = [];
        for (var i = 0; i < blankLeds.length; i++) {
            frame.push(getPixel(null, null, 0, 255, 0, blankLeds[i].id));
        }
        for (var i = 0; i < keyedLeds.length; i++) {
            frame.push(getPixel(null, null, 0, 0, 255, keyedLeds[i].id));
        }
        frames.push(frame.join(","));
        animation.frames = frames;
        return animation;
    },

    /**
     * Testing out flashing random colors on pixel id 1 and 16, which on the ktype seem to be
     * the escape and pause keys.
     */
    "escapeTest": function() {
        var animation = {
            "settings": "framedelay:1, loop, replace:all",
            "type": "animation",
            "frames": []
        };
        var frames = [];
        for (var i = 0; i < 10; i++) {
            var frame = [];
            frame.push(getPixel(null, null, Math.floor(Math.random() * 255), Math.floor(Math.random() * 0), Math.floor(Math.random() * 0), 1));
            frame.push(getPixel(null, null, Math.floor(Math.random() * 255), Math.floor(Math.random() * 0), Math.floor(Math.random() * 0), 16));
            frames.push(frame.join(","));
        }

        animation.frames = frames;
        return animation;
    }
};

main();

// Could this be an invader?
// #####
// # # #
// #####
// #   #
// ## ##
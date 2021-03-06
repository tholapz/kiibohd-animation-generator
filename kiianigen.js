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
var exec = require( 'child_process' ).exec;

// Get the generator to be used.
var generator = process.argv[2];
if (generator) {
    generator = generator.trim();
}

var CONF_FILE = "./kiianiconf.json";
var KTYPE_FILE = '/KType-Standard.json';
var KLL_FILE = '/kll.json';

var maxRow = 0;
var maxCol = 0;
var json, leds, blankLeds, keyedLeds, kll;

// The demo configuration that is written to kiianiconf.json if one does not exist when running
// with the "conf" option.
var DEMO_CONF = {
    "animations": {
        "KARR 1.0": {
            "generator": "kitt2000",
            "params": [[255, 102, 0]]
        },
        "KITT 2000": {
            "generator": "kitt2000",
            "params": []
        },
        "White Noise": {
            "generator": "whiteNoise"
        },
        "Turquoise Hexagon Sun": {
            "generator": "baseTopBreath",
            "params": [[0, 255, 0], [0, 0, 255]]
        },
        "Iced Cooly": {
            "generator": "dodgyPixel",
            "params": [[204, 204, 204], [0, 0, 255]]
        },
        "Quick RGB with Tracers": {
            "generator": "verticalPulseWithTracers",
            "params": [17, [255, 0, 0], [0, 255, 0], [0, 0, 255]]
        }
    },
    "activeAnimations": [
        "KARR 1.0",
        "KITT 2000",
        "Turquoise Hexagon Sun",
        "Iced Cooly",
        "White Noise",
        "Quick RGB with Tracers"
    ]
};

var FUNC_KEY_GROUP = [["0x01", "0x10"]];
var LEFT_GROUP = ["0x11", "0x24", "0x36", "0x45", ["0x55", "0x57"]];
var RIGHT_GROUP = ["0x1F", "0x31", "0x43", "0x52", ["0x59", "0x5C"]];
var NAV_GROUP = [["0x21", "0x23"],["0x33", "0x35"]];
var ARROW_GROUP = ["0x54", ["0x5D", "0x5F"]];
var LETTERS_GROUP = [["0x12","0x1D"],["0x25", "0x30"], ["0x37", "0x41"],
                     ["0x47", "0x50"]];
var SPACE_GROUP = ["0x58"];
var BASE_GROUP = [[88, 119]];
var KEY_GROUPS = {
    "FUNC_KEY_GROUP": FUNC_KEY_GROUP,
    "LEFT_GROUP": LEFT_GROUP,
    "LETTERS_GROUP": LETTERS_GROUP,
    "RIGHT_GROUP": RIGHT_GROUP,
    "SPACE_GROUP": SPACE_GROUP,
    "NAV_GROUP": NAV_GROUP,
    "ARROW_GROUP": ARROW_GROUP,
    "BASE_GROUP": BASE_GROUP
};

var LEFT_BASE_LEDS =  [ 94,  95,  96,  97,  98,  99,
                       100, 101, 102, 103, 104, 105,
                       106, 107, 108, 109, 110];
var RIGHT_BASE_LEDS = [ 94,  93,  92,  91,  90,  89,
                        88, 119, 118, 117, 116, 115,
                       114, 113, 112, 111, 110];
var ledsByScanCode;
var ledIdByScanCode;

/**
 * The main function for the script. This basically opens a few of the files from the
 * KType-Standard directory, builds the designated animations, and writes out a json config
 * file that can be imported into the kiibohd configurator.
 */
function main() {
    var i;

    // Test multicolor bleed interpolations
    // console.info("linear\n", multiColorBleed(20, linearInterpolate, [0,0,0], [20,20,20]));
    // console.info("sine\n", multiColorBleed(20, sineInterpolate, [0,0,0], [20,20,20]));
    // console.info("random\n", multiColorBleed(20, randomInterpolate, [0,0,0], [20,20,20]));
    // return;

    // If the source KType-Standard directory is different from ../KType-Standard, then it must be
    // the secondary argument.
    var srcConfigDir = "../KType-Standard";
    if (process.argv.length > 3) {
        srcConfigDir = process.argv[3].trim();
    }

    // If no generator is provided, then bail out.
    if (!generator || (!generators[generator] && generator !== 'all' && generator !== 'conf')) {
        console.info("Unknown generator: ", generator);
        var gens = Object.keys(generators);
        gens.unshift('');
        console.info("Either specify 'all', 'conf', or use one of the following generators:" +
                     gens.join("\n\t"));
        return;
    }

    // Get info about the current configuration files from KType-Standard directory.
    if(!fs.existsSync(srcConfigDir + KTYPE_FILE)) {
        console.log("KType-Standard.json not found")
    } else {
      json = JSON.parse(require('fs').readFileSync(srcConfigDir + KTYPE_FILE, 'utf8'));
    }

    // The current animations
    if (!json.animations) {
        json.animations = {};
    }
    var animOrig = json.animations;

    // Information about the leds
    leds = json.leds;
    ledsByScanCode = {};
    ledIdByScanCode= {};
    blankLeds = [];
    keyedLeds = [];
    for (i = 0; i < leds.length; i++) {
        ledsByScanCode[leds[i].scanCode] = leds[i];
        ledIdByScanCode[leds[i].scanCode] = leds[i].id;
        if (leds[i].scanCode) {
            keyedLeds.push(leds[i]);
        } else {
            blankLeds.push(leds[i]);
        }
    }

    // Get the max pixel rows and columns

    if (!fs.existsSync(srcConfigDir + KLL_FILE)) {
      console.log("kll.json not found")
    } else {
      kll = JSON.parse(require('fs').readFileSync(srcConfigDir + KLL_FILE, 'utf8'));
    }
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
    } else if (generator === 'conf') {
        var confData;
        if (!fs.existsSync(CONF_FILE)) {
            confData = DEMO_CONF;
            fs.writeFileSync(CONF_FILE, JSON.stringify(DEMO_CONF, null, 4));
        } else {
            confData = JSON.parse(require('fs').readFileSync(CONF_FILE, 'utf8'));
        }
        generateFromConf(animOrig, confData);
    } else {
        animOrig[generator] = generators[generator]();
    }

    // Now set up the keys for triggering the animations. we set up the keys so that in layer 1,
    // each key turns on one animation and turns off all the rest. We also turn off the key for
    // layer 1, so that triggering the animation won't send key strokes to the foreground
    // application. If you want this stuff to happen on a different layer or with different
    // keys, change triggerLayer and keys below.
    var triggerLayer = "1";
    // Use scan code for finding the keys. On querty keyboards these keys map to:
    // qwertyuiop[]\
    // asdfghjkl;'
    // zxcvbnm,./
    // Scan codes 0x25-0x30, 0x37-0x41, 0x47-0x4F
    var keyCodes = ["0x25", "0x26", "0x27", "0x28", "0x29", "0x2A", "0x2B", "0x2C",
                        "0x2D", "0x2E", "0x2F", "0x30",
                    "0x37", "0x38", "0x39", "0x3A", "0x3B", "0x3C", "0x3D", "0x3E",
                        "0x3F", "0x40", "0x41",
                    "0x47", "0x48", "0x49", "0x4A", "0x4B", "0x4C", "0x4D", "0x4E", "0x4F"];
    var triggerKeys = [];
    var matrix = json.matrix;

    for (i = 0; i < matrix.length; i++) {
        if (keyCodes.indexOf(matrix[i].code) > -1) {
            triggerKeys[keyCodes.indexOf(matrix[i].code)] = matrix[i];
        }
    }
    var animNames = Object.keys(animOrig);
    var aniMappingText = ['Animations are mapped to the following keys:'];
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
        aniMappingText.push(iKey.layers["0"].key  + ": " + animNames[i]);
    }

    console.info("\n" + aniMappingText.join("\n\t"));


    // Change out some of the headers
    var theDate = new Date();
    json.header.Author = "intafon (ryan-todd-ryan) " + dateFormat(theDate, "yyyy");
    json.header.Date = dateFormat(theDate, "yyyy-mm-dd");
    json.header.Layout = (json.header.Layout + " + Kiianigen " +
                          (generator[0].toUpperCase() + generator.substring(1)));
    json.header.KiianigenKeyMap = aniMappingText;

    var newFileName = "KType-" + dateFormat(theDate, "yyyymmdd-HHMMss") + "-" + generator;

    var jsonOutDir = "./json_out";
    if (!fs.existsSync(jsonOutDir)){
        fs.mkdirSync(jsonOutDir);
    }
    var newFilePath = jsonOutDir + '/' + newFileName + '.json';
    fs.writeFileSync(newFilePath, JSON.stringify(json, null, 4));

    console.info("\nNew config json has been saved to file: " + newFileName);

    // possible values: 'darwin', 'freebsd', 'linux', 'sunos' or 'win32'
    if (process.platform === 'darwin') {
        var cmd = 'cat "' + newFilePath + '" | pbcopy';
        var copier = exec(cmd,
            function(error, stdout, stderr) {
                if (error !== null) {
                    console.log("\nCould not copy the json to clipboard: ", error);
                } else {
                    console.log("JSON copied to clipboard. Paste away!");
                }
            }
        );
    }

    // console.info("move output to KType-Standard.json and run 'dfu-util " +
    //              "-D kiibohd.dfu.bin' to flash keyboard");
}

/**
 * Generates animations based on the kiianiconf.json file specifications.
 * @param  {Object} animOrig
 *         The original animations object.
 * @param  {Object} confData
 *         The kiianiconf.json data.
 */
function generateFromConf(animOrig, confData) {
    // TODO: come up with a way to verify that the confData parameters specified for the given
    // animations actually make sense...

    // var anims = [];
    // var animNames = [];
    var i;
    for (i = 0; i < confData.activeAnimations.length; i++) {
        var animName = confData.activeAnimations[i];
        var anim = confData.animations[animName];
        var gen = generators[anim.generator];
        var params = anim.params;
        // We have to use single word names for the animations in the configurator
        var animNameToUse = animName.replace(/\s+/g, '_').replace(/\W+/g,'');
        if (params) {
            animOrig[animNameToUse] = gen.apply(null, params);
        } else {
            animOrig[animNameToUse] = gen();
        }
    }
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
 * Gets a numeric value somewhere between 2 other numeric values, given a step and a total number
 * of steps to be travelled between those values, in a linear fashion.
 */
function linearInterpolate(step, steps, val1, val2) {
    return (val2 - val1) * (step / steps) + val1;
}

/**
 * Gets a numeric value somewhere between 2 other numeric values, given a step and a total number
 * of steps to be travelled between those values, in a fashion akin to travelling along the sine
 * curve between -PI/2 and PI/2.
 */
function sineInterpolate(step, steps, val1, val2) {
    var angle = (step / steps) * Math.PI - (Math.PI / 2);
    var sine = Math.sin(angle);
    var interpolateVal = (sine + 1) / 2;
    return (val2 - val1) * interpolateVal + val1;
}

/**
 * Gets a random numeric value between 2 other values.
 */
function randomInterpolate(step, steps, val1, val2) {
    return (val2 - val1) * Math.random() + val1;
}

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
 * @param  {Function} interpolateFunc
 *         The function to be used for interpolating between the values. Default used is the
 *         linearInterpolate function.
 * @return {Array}
 *         An array of arrays of r,g,b color values representing the full bleed.
 */
function colorBleed(origColor, destColor, steps, step, interpolateFunc) {
    if (steps === undefined || steps < 2) {
        steps = 2;
        step = 1;
    }
    if (interpolateFunc === undefined) {
        interpolateFunc = linearInterpolate;
    }
    var i;
    var colors = [];
    for (var s = 0; s <= steps; s++) {
        /*jshint loopfunc: true */
        var color = origColor.map(function(origChannel, idx) {
            var destChannel = destColor[idx];
            var val = interpolateFunc(s, steps, origChannel, destChannel);
            // Round the numbers? Does it matter?
            val = Math.round(val);
            // ensure the color channel value is between 0 - 255
            val = Math.max(val, 0);
            val = Math.min(val, 255);
            return val;
        });
        colors.push(color);
    }
    if (step !== undefined && step !== null) {
        return colors[step];
    }
    return colors;
}

/**
 * Creates an array of color values representing a gradual fade between multiple colors. Usage:
 * var colorArray = multiColorBleed(30, [0,0,0], [255,255,255], [0,0,255]);
 *
 * @param  {Number} frameCountPerColor
 *         The number of frames used to get from one color to the next.
 * @param  {Function} interpolateFunc
 *         The function used for interpolating between the values.
 * @param  ...args
 *         The colors that should be animated, as arrays of [r,g,b].
 * @return {Array}
 *         The array of colors.
 */
function multiColorBleed(frameCountPerColor, interpolateFunc) {
    var colorValues = Array.prototype.slice.call(arguments, 2);
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
        var fade = colorBleed(cOrig, cDest, frameCountPerColor, null, interpolateFunc);
        if (i > 0) {
            fade = fade.slice(1);
        }
        colors = colors.concat(fade);
    }
    colors.pop();
    return colors;
}

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
    var args = Array.prototype.slice.call(arguments, 1);
    var colors = multiColorBleed.apply(null, [frameCountPerColor, undefined].concat(args));

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

/**
 * Creates an animation in which colors pulse from one to another with breath-like cadence.
 */
function colorBreatheGenerator(breathsPerMinute) {
    var FRAME_DELAY = 3;
    var secondsPerBreath = 60 / breathsPerMinute;
    // Divide by 2 below so that the steps from one color to another is the inhale of a breath.
    var stepsPerInhale = (secondsPerBreath * 100 / FRAME_DELAY) / 2;
    var colorValues = Array.prototype.slice.call(arguments, 1);
    var colors = multiColorBleed.apply(null, [stepsPerInhale, sineInterpolate].concat(colorValues));

    var animation = {
        "settings": "framedelay:" + FRAME_DELAY + ", framestretch, loop, replace:all, pfunc:interp",
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

/**
 * Normalizes a color value to be an integer between 0 and 255.
 * @param  {Number} colorVal
 *         The color values to normalize.
 * @return {Number}
 *         The normalized value.
 */
function normColor(colorVal) {
    return Math.max(Math.min(Math.round(colorVal), 255), 0);
}

/**
 * Takes a frame array of pixel values that use pixel ids (this does not work with row column
 * defined pixels), and sorts them based on pixel id.
 *
 * @param  {Array} frame
 *         An array of pixels defined using pixel id.
 */
function sortPixelFrame(frame) {
    frame.sort(function(a, b) {
        return parseInt((a).match(/\[(\d+)\]/)[1], 10) -
            parseInt((b).match(/\[(\d+)\]/)[1], 10);
    });
}

/** Returns true if value is defined and not null. */
function defd(val) {
    return val !== undefined && val !== null;
}

function getShiftedArray(arr) {
    var shiftedArr = arr.slice(0);
    shiftedArr.push(shiftedArr.shift());
    return shiftedArr;
}

// The generators are an object map of animation generators.
var generators = {

    /**
     * Blinks random keys.
     */
    "dodgyPixel": function(hiColor, bgColor) {
        if (!hiColor) {
            hiColor = [255, 255, 255];
        }
        if (!bgColor) {
            bgColor = [25, 25, 25];
        }
        var animation = {
            "settings": "framedelay:1, loop, replace:all",
            "type": "animation",
            "frames": []
        };
        var frames = [];
        var frame = [];
        for (var x = 0; x <= maxRow; x++) {
            for (var y = 0; y <= maxCol; y++) {
                frame.push(getPixel(x, y, bgColor[0], bgColor[1], bgColor[2]));
            }
        }
        frames.push(frame.join(","));
        for (var i = 0; i < 50; i++) {
            var rx = Math.round(Math.random() * maxRow);
            var ry = Math.round(Math.random() * maxCol);
            frames.push(getPixel(rx, ry, hiColor[0], hiColor[1], hiColor[2]));
            frames.push(getPixel(rx, ry, bgColor[0], bgColor[1], bgColor[2]));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Makes your keyboard look vaguely like Kitt 200 from Knight Rider.
     */
    "kitt2000": function(hiColor, bgColor, width) {
        // console.info(arguments);
        if (!hiColor) {
            hiColor = [255, 0, 0];
        }
        if (!bgColor) {
            bgColor = [0, 0, 0];
        }
        if (width === undefined) {
            width = 5;
        }

        var animation = {
            "settings": "framedelay:2, framestretch, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };
        // Number of columns over which to bleed to bg color.
        var bleed = width;
        var bleedColors = colorBleed(hiColor, bgColor, bleed);
        bleedColors.shift();
        var reversedBleedColors = bleedColors.slice(0).reverse();
        var lastBleedColor = colorBleed(hiColor, bgColor, bleed, bleed - 1);

        var frames = [];
        var steps = 50;
        var step = 100 / steps;
        var overflow = 1; // steps beyond which to go off the board
        var columns = [];
        var columnOverflowAdjustment = -1;
        var minColumn = 0;// - ((bleed + columnOverflowAdjustment) * step);
        var maxColumn = 102;// + ((bleed + columnOverflowAdjustment) * step);
        var column = minColumn;
        while (column <= maxColumn) {
            columns.push(column);
            column += step;
        }
        // console.info(columns);

        function createKitt2000Frame(i) {
            var col, j;
            var frame = [];
            frame.push(getPixel(null,
                                "-2%",
                                bgColor[0],
                                bgColor[1],
                                bgColor[2]));

            if (reversedBleedColors.length - i in reversedBleedColors) {
                frame.push(getPixel(null,
                                    "0%",
                                    reversedBleedColors[reversedBleedColors.length - i][0],
                                    reversedBleedColors[reversedBleedColors.length - i][1],
                                    reversedBleedColors[reversedBleedColors.length - i][2]));
            } else if (reversedBleedColors.length - i < 0) {
                frame.push(getPixel(null,
                                    "0%",
                                    bgColor[0],
                                    bgColor[1],
                                    bgColor[2]));
                frame.push(getPixel(null,
                                    (columns[i - reversedBleedColors.length]) + "%",
                                    reversedBleedColors[0][0],
                                    reversedBleedColors[0][1],
                                    reversedBleedColors[0][2]));
            }

            frame.push(getPixel(null,
                                columns[i] + "%",
                                bleedColors[0][0],
                                bleedColors[0][1],
                                bleedColors[0][2]));

            if (columns.length - i + 1 in reversedBleedColors) {
                frame.push(getPixel(null,
                                    "100%",
                                    reversedBleedColors[columns.length - i + 1][0],
                                    reversedBleedColors[columns.length - i + 1][1],
                                    reversedBleedColors[columns.length - i + 1][2]));
            } else if (i + reversedBleedColors.length < columns.length) {
                frame.push(getPixel(null,
                                    (columns[i + reversedBleedColors.length]) + "%",
                                    reversedBleedColors[0][0],
                                    reversedBleedColors[0][1],
                                    reversedBleedColors[0][2]));
                frame.push(getPixel(null,
                                    "100%",
                                    bgColor[0],
                                    bgColor[1],
                                    bgColor[2]));

            }

            frame.push(getPixel(null,
                                "102%",
                                bgColor[0],
                                bgColor[1],
                                bgColor[2]));

            return frame;
        }

        var i;
        for (i = 0; i < columns.length; i++) {
            frames.push(createKitt2000Frame(i).join(","));
        }
        for (i = columns.length - 2; i > 1; i--) {
            frames.push(createKitt2000Frame(i).join(","));
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
            frame.push(getPixel(-2 + "%", null,
                                bgColor[0],
                                bgColor[1],
                                bgColor[2]));
            frame.push(getPixel(((i - overflow) * step) + "%",
                                null,
                                hiColor[0],
                                hiColor[1],
                                hiColor[2]));
            frame.push(getPixel(102 + "%", null,
                                bgColor[0],
                                bgColor[1],
                                bgColor[2]));

            frames.push(frame.join(","));
        }
        for (i = steps + overflow + 1; i > -overflow - 1; i--) {
            frame = [];
            frame.push(getPixel(-2 + "%",
                                bgColor[0],
                                null,
                                bgColor[1],
                                bgColor[2]));
            frame.push(getPixel(((i - overflow) * step) + "%",
                                null,
                                hiColor[0],
                                hiColor[1],
                                hiColor[2]));
            frame.push(getPixel(102 + "%",
                                null,
                                bgColor[0],
                                bgColor[1],
                                bgColor[2]));
            frames.push(frame.join(","));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Pulse the entire keyboard red.
     */
    "macSleepBreath": function(hiColor, loColor) {
        if (!hiColor) {
            hiColor = [255, 255, 255];
        }
        if (!loColor) {
            loColor = [1, 1, 1];
        }
        return colorBreatheGenerator(12, hiColor, loColor);
    },

    /**
     * Pulse the entire keyboard red.
     */
    "blueGreenBreath": function() {
        return colorBreatheGenerator(12, [0, 255, 0], [0, 0, 255]);
    },

    /**
     * Pulse the keyboard top and bottom alternating blue and green, with a base spin.
     */
    "blueGreenBaseTopBreathSpin": function() {
        var breathsPerMinute = 12;
        var FRAME_DELAY = 10;//3;
        var secondsPerBreath = 6.4;//Math.round(60 / breathsPerMinute);
        // Divide by 2 below so that the steps from one color to another is the inhale of a breath.
        var stepsPerInhale = (secondsPerBreath * 100 / FRAME_DELAY) / 2;
        var colorValues = Array.prototype.slice.call(arguments, 1);
        var topColors = multiColorBleed(stepsPerInhale, sineInterpolate, [0, 255, 0], [0, 0, 255]);
        var botColors = multiColorBleed(stepsPerInhale, sineInterpolate, [0, 0, 255], [0, 255, 0]);

        // 32 = secondsPerBreath * 100 / FRAME_DELAY / 2
        // 64 = secondsPerBreath * 100 / FRAME_DELAY
        // 64 * FRAME_DELAY = secondsPerBreath * 100

        var animation = {
            "settings": "framedelay:" + FRAME_DELAY +
                        ", framestretch, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };

        var i, p;
        var frames = [];
        var baseIds = [];
        for (i = 88; i <= 119; i++) {
            baseIds.push(i);
        }
        var frame, color;
        for (i = 0; i < topColors.length; i++) {
            frame = [];
            var botColor = botColors[i];
            var topColor = topColors[i];

            // Do keyboard color
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 1));
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 87));
            // frame.push(getPixel(null, null, botColor[0], botColor[1], botColor[2], 88));
            // frame.push(getPixel(null, null, botColor[0], botColor[1], botColor[2], 119));

            // color the base
            var popped = baseIds.pop();
            baseIds.unshift(popped);
            var steps = 119 - 88;
            for (var j = 0; j < baseIds.length; j++) {
                var perc = j / baseIds.length;
                frame.push(getPixel(null,
                                    null,
                                    normColor(botColor[0] * perc),
                                    normColor(botColor[1] * perc),
                                    normColor(botColor[2] * perc),
                                    baseIds[j]));
            }

            frames.push(frame.join(","));
        }
        animation.frames = frames;
        return animation;
    },

    "keyGroupCycler": function(stepsPerColor) {
        if (stepsPerColor === undefined || stepsPerColor === null) {
            stepsPerColor = 16;
        }
        var colorValues = Array.prototype.slice.call(arguments, 1);
        if (!defd(colorValues[0])) {
            colorValues[0] = [0, 255, 0];
        }
        if (!defd(colorValues[1])) {
            colorValues[1] = [0, 0, 255];
        }
        var colorCount = colorValues.length;

        var animation = {
            "settings": "framedelay:" + 10 +
                        ", framestretch, loop, replace:all",//, pfunc:interp",
            "type": "animation",
            "frames": []
        };

        var curColors = colorValues.slice(0);
        var keyGroupNames = Object.keys(KEY_GROUPS);
        var colorArrays = {};
        var keyGroupFrames = [];
        var frameCount = 0;
        for (var i = 0; i < keyGroupNames.length; i++) {
            colorArrays[keyGroupNames[i]] = curColors.slice(0);
            keyGroupFrames[keyGroupNames[i]] =
                multiColorBleed.apply(null, [stepsPerColor, sineInterpolate]
                                      .concat(colorArrays[keyGroupNames[i]]));
            frameCount = keyGroupFrames[keyGroupNames[i]].length;
            curColors = getShiftedArray(curColors);
        }
        console.info(keyGroupFrames, frameCount);

        var frames = [];

        function keyToId(key) {
            if (typeof(key) === 'string') {
                key = ledIdByScanCode[key];
            }
            return key;
        }
        // function createPixelFromKey(key, color) {
        //     if (typeof(key) === 'string') {
        //         key = ledIdByScanCode[key];
        //     }
        //     return getPixel(null, null, color[0], color[1], color[2], key);
        // }

        // XXX: using interpolation and providing key ranges here did not seem to work properly...
        // now using explicit led assignments, which is very heavy...

        for (i = 0; i < frameCount; i++) {
            var frame = [];
            for (var g in KEY_GROUPS) {
                var keys = KEY_GROUPS[g];
                var color = keyGroupFrames[g][i];
                for (var j = 0; j < keys.length; j++) {
                    if (Array.isArray(keys[j])) {
                        var id0 = keyToId(keys[j][0]);
                        var idN = keyToId(keys[j][1]);
                        for (var k = id0; k <= idN; k++) {
                            frame.push(getPixel(null, null, color[0], color[1], color[2], k));
                        }
                        // frame.push(createPixelFromKey(keys[j][0], color));
                        // frame.push(createPixelFromKey(keys[j][1], color));
                    } else {
                        // frame.push(createPixelFromKey(keys[j], color));
                        frame.push(getPixel(null, null, color[0], color[1], color[2],
                                            keyToId(keys[j])));
                    }
                }
            }
            frames.push(frame.join(","));
        }

        animation.frames = frames;
        return animation;
    },

    /**
     * Pulse the keyboard top and botttom with alternating colors, and display a symmetric tracer
     * animation on the base (colors start on bottom front and wrap to the right and left around to
     * the back.
     *
     * @param  {Number} stepsPerColor
     *         The steps per color. If you want there to be 64 total frames, and there are 2 colors,
     *         then this value should be 32.
     * @param  {Array[s]} ...colors
     *         The colors to use in the animation.
     * @return {Object}
     *         The animation object.
     */
    "verticalPulseWithTracers": function(stepsPerColor) {
        if (stepsPerColor === undefined || stepsPerColor === null) {
            stepsPerColor = 32;
        }
        var colorValues = Array.prototype.slice.call(arguments, 1);
        if (!defd(colorValues[0])) {
            colorValues[0] = [0, 255, 0];
        }
        if (!defd(colorValues[1])) {
            colorValues[1] = [0, 0, 255];
        }
        var colorCount = colorValues.length;

        var i;
        var breathsPerMinute = 12;
        var FRAME_DELAY = 5;//3;
        var secondsPerBreath = 6.4;//Math.round(60 / breathsPerMinute);

        var stepsPerInhale = stepsPerColor;//(secondsPerBreath * 100 / FRAME_DELAY) / 2;

        // Set up the animation frames for the symmetrical tracers
        //                                |
        //           105 106 107 108 109 110 111 112 114 115
        //       104                                         116
        //   103                                                 117
        // --102                                                 118--
        //   101                                                 119
        //       100                                             88
        //           99  98  97  96  95  94  93  92  91  90  89
        //                                |
        var ltSide = LEFT_BASE_LEDS.slice(0);
        var rtSide = RIGHT_BASE_LEDS.slice(0);

        // The steps per inhale at a minimum needs to be the 17 of the ltSide and rtSide above. This
        // color pulsing is pretty fast as it is...
        if (ltSide.length > stepsPerInhale) {
            stepsPerInhale = ltSide.length;
        }
        // We need to sync the tracer animation so that it can complete full rounds during the
        // entire color pulse animation.
        var actualStepsPerInhale = stepsPerInhale;

        // var pulseCount = colorCount
        if ((colorCount * actualStepsPerInhale) % ltSide.length > 0) {
            var currentLoops = Math.floor((colorCount *
                                           actualStepsPerInhale) / ltSide.length);
            var diff = (colorCount * actualStepsPerInhale) - (ltSide.length * currentLoops);
            var addSteps = Math.ceil(diff / currentLoops);
            for (i = 0; i < addSteps; i++) {
                ltSide.push(null);
                rtSide.push(null);
            }
            if (ltSide.length * currentLoops > actualStepsPerInhale * colorCount) {
                stepsPerInhale = Math.round(ltSide.length * currentLoops / colorCount);
            }
        }

        // Now set up the pulsing colors
        // var topColors = multiColorBleed(stepsPerInhale, sineInterpolate, color1, color2);
        // var botColors = multiColorBleed(stepsPerInhale, sineInterpolate, color2, color1);
        var topColors = multiColorBleed.apply(null, [stepsPerInhale, sineInterpolate]
                                              .concat(colorValues));
        var shiftedColors = colorValues.slice(0);
        shiftedColors.push(shiftedColors.shift());
        var botColors = multiColorBleed.apply(null, [stepsPerInhale, sineInterpolate]
                                              .concat(shiftedColors));

        var animation = {
            "settings": "framedelay:" + FRAME_DELAY +
                        ", framestretch, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };

        var p;
        var frames = [];
        var baseIds = [];
        for (i = 88; i <= 119; i++) {
            baseIds.push(i);
        }

        var frame, color;
        for (i = 0; i < topColors.length; i++) {
            frame = [];
            var botColor = botColors[i];
            var topColor = topColors[i];

            // Do keyboard color
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 1));
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 87));

            // Do base colors
            var onIntensity = 1;
            var offIntensity = 0.05;
            for (var j = 0; j < ltSide.length; j++) {
                var perc = j / ltSide.length;
                if (ltSide[j] !== null) {
                    if (j > ltSide.length - 4) {
                        frame.push(getPixel(null,
                                            null,
                                            normColor(botColor[0] * onIntensity),
                                            normColor(botColor[1] * onIntensity),
                                            normColor(botColor[2] * onIntensity),
                                            ltSide[j]));
                        if (ltSide[j] !== 94 && ltSide[j] !== 110) {
                            frame.push(getPixel(null,
                                                null,
                                                normColor(botColor[0] * onIntensity),
                                                normColor(botColor[1] * onIntensity),
                                                normColor(botColor[2] * onIntensity),
                                                rtSide[j]));
                        }
                    } else {
                        frame.push(getPixel(null,
                                            null,
                                            normColor(botColor[0] * offIntensity),
                                            normColor(botColor[1] * offIntensity),
                                            normColor(botColor[2] * offIntensity),
                                            ltSide[j]));
                        if (ltSide[j] !== 94 && ltSide[j] !== 110) {
                            frame.push(getPixel(null,
                                                null,
                                                normColor(botColor[0] * offIntensity),
                                                normColor(botColor[1] * offIntensity),
                                                normColor(botColor[2] * offIntensity),
                                                rtSide[j]));
                        }
                    }
                }
            }
            sortPixelFrame(frame);
            frames.push(frame.join(","));

            // color the base
            var lPop = ltSide.shift();
            ltSide.push(lPop);
            var rPop = rtSide.shift();
            rtSide.push(rPop);
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Pulse the keyboard top and bottom alternating blue and green.
     */
    "baseTopBreath": function(color1, color2) {
        if (!color1) {
            color1 = [0, 255, 0];
        }
        if (!color2) {
            color2 = [0, 0, 255];
        }
        var breathsPerMinute = 12;
        var FRAME_DELAY = 3;
        var secondsPerBreath = Math.round(60 / breathsPerMinute);
        // Divide by 2 below so that the steps from one color to another is the inhale of a breath.
        var stepsPerInhale = (secondsPerBreath * 100 / FRAME_DELAY) / 2;
        var colorValues = Array.prototype.slice.call(arguments, 1);
        var topColors = multiColorBleed(stepsPerInhale, sineInterpolate, color1, color2);
        var botColors = multiColorBleed(stepsPerInhale, sineInterpolate, color2, color1);

        var animation = {
            "settings": "framedelay:" + FRAME_DELAY +
                        ", framestretch, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };

        var i, p;
        var frames = [];
        var frame, color;
        for (i = 0; i < topColors.length; i++) {
            frame = [];
            var botColor = botColors[i];
            var topColor = topColors[i];
            // Do interpolation between the top keys and bottom keys
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 1));
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 87));
            frame.push(getPixel(null, null, botColor[0], botColor[1], botColor[2], 88));
            frame.push(getPixel(null, null, botColor[0], botColor[1], botColor[2], 119));
            frames.push(frame.join(","));
        }
        animation.frames = frames;
        return animation;
    },

    /**
     * Pulse the entire keyboard red.
     */
    "redPulse": function() {
        return colorPulseGenerator(240, [255, 25, 0], [0, 0, 0]);
    },

    /**
     * Pulse the entire keyboard between colors, linearly.
     */
    "linearPulse": function(hiColor, loColor) {
        if (!hiColor) {
            hiColor = [255, 25, 0];
        }
        if (!loColor) {
            loColor = [0, 0, 0];
        }
        return colorPulseGenerator(240, hiColor, loColor);
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
        return colorPulseGenerator(120,
                                   [255, 0, 0],
                                   [255, 255, 255],
                                   [0, 255, 0],
                                   [255, 255, 255],
                                   [0, 0, 255],
                                   [255, 255, 255]);
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
        // console.info("whitenoise");
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
        var i;
        var animation = {
            "settings": "framedelay:5, loop, replace:all",
            "type": "animation",
            "frames": []
        };
        var frames = [];
        var frame = [];
        for (i = 0; i < blankLeds.length; i++) {
            frame.push(getPixel(null, null, 0, 255, 0, blankLeds[i].id));
        }
        for (i = 0; i < keyedLeds.length; i++) {
            frame.push(getPixel(null, null, 0, 0, 255, keyedLeds[i].id));
        }
        frames.push(frame.join(","));
        animation.frames = frames;
        return animation;
    },

    /**
     * An example using the led data to fill in the pixels for the base and the keys differently;
     * in this case, the base leds are green and the keys are blue.
     */
    "topAndBottom2": function() {
        var i;
        var animation = {
            "settings": "framedelay:5, loop, replace:all, pfunc:interp",
            "type": "animation",
            "frames": []
        };
        var topColor = [0,255,0];
        var botColor = [0,0,255];
        var frames = [];
        var ids = [];
        for (i = 88; i <= 119; i++) {
            ids.push(i);
        }
        for (i = 88; i <= 119; i++) {
            var frame = [];
            // color the top
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 1));
            frame.push(getPixel(null, null, topColor[0], topColor[1], topColor[2], 87));

            // color the base
            var popped = ids.pop();
            ids.unshift(popped);
            var steps = 119 - 88;
            for (var j = 0; j < ids.length; j++) {
                var perc = j / ids.length;
                frame.push(getPixel(null,
                                    null,
                                    normColor(botColor[0] * perc),
                                    normColor(botColor[1] * perc),
                                    normColor(botColor[2] * perc),
                                    ids[j]));
            }
            frames.push(frame.join(","));
        }

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
            frame.push(getPixel(null,
                                null,
                                Math.floor(Math.random() * 255),
                                Math.floor(Math.random() * 0),
                                Math.floor(Math.random() * 0),
                                1));
            frame.push(getPixel(null,
                                null,
                                Math.floor(Math.random() * 255),
                                Math.floor(Math.random() * 0),
                                Math.floor(Math.random() * 0),
                                16));
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

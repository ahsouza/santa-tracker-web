/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

/* jshint node: true */

const gulp = require('gulp');
const gutil = require('gulp-util');
const $ = require('gulp-load-plugins')();
const fs = require('fs');
const changedFlag = require('./gulp_scripts/changed_flag');
const path = require('path');
const del = require('del');
const file_manifest = require('./gulp_scripts/file_manifest');
const i18n_replace = require('./gulp_scripts/i18n_replace');
const i18n_manifest = require('./gulp_scripts/i18n_manifest');
const devScene = require('./gulp_scripts/dev-scene');
const styleModules = require('./gulp_scripts/style_modules');
const mergeStream = require('merge-stream');

/* Default version is 'vYYYYMMDDHHMM'. */
const DEFAULT_STATIC_VERSION = 'v' + (new Date).toISOString().replace(/[^\d]/g, '').substr(0, 12);

const argv = require('yargs')
    .help('help')
    .strict()
    .epilogue('https://github.com/google/santa-tracker-web')
    .command('default', 'build CSS and JavaScript for development version')
    .command('serve', 'serves development version')
    .command('dist', 'build production version')
    .option('pretty', {
      type: 'boolean',
      default: false,
      describe: 'production output to dist_pretty'
    })
    .option('strict', {
      type: 'boolean',
      default: false,
      describe: 'perform strict i18n checks'
    })
    .option('api_base', {
      type: 'string',
      default: 'https://santa-api.appspot.com/',
      describe: 'base URL for Santa\'s API'
    })
    .option('build', {
      alias: 'b',
      type: 'string',
      default: DEFAULT_STATIC_VERSION,
      describe: 'production build tag'
    })
    .option('baseurl', {
      type: 'string',
      default: '',
      describe: 'production base href'
    })
    .option('scene', {
      type: 'string',
      default: null,
      describe: 'only build assets for this scene'
    })
    .option('port', {
      alias: 'p',
      type: 'number',
      default: 3000,
      describe: 'port to serve on'
    })
    .option('devmode', {
      type: 'boolean',
      default: false,
      describe: 'run scenes directly with raw source files and livereload'
    })
    .argv;

const COMPILER_PATH = 'node_modules/google-closure-compiler/compiler.jar';
const SASS_FILES = '{scenes,sass,elements}/**/*.scss';
const IGNORE_COMPILED_JS = '!**/*.min.js';
const CLOSURE_FILES = ['scenes/*/js/**/*.js', IGNORE_COMPILED_JS];
const SERVICE_FILES = ['js/service/*.js', IGNORE_COMPILED_JS];

const SHARED_EXTERNS = [
  'components/web-animations-utils/externs*.js',
  'node_modules/google-closure-compiler/contrib/externs/maps/google_maps_api_v3_exp.js',
  'node_modules/google-closure-compiler/contrib/externs/jquery-1.9.js',
];

const AUTOPREFIXER_BROWSERS = ['> 3%', 'chrome >= 44', 'ios_saf >= 9', 'ie >= 11'];

const CLOSURE_WARNINGS = [
  // https://github.com/google/closure-compiler/wiki/Warnings
  'accessControls',
  'const',
  'visibility'
];
const CLOSURE_SAFE_WARNINGS = CLOSURE_WARNINGS.concat([
  'checkTypes',
  'checkVars'
]);

const API_BASE_URL = argv.api_base.replace(/\/*$/, '/');
const STATIC_BASE_URL = argv.baseurl.replace(/\/*$/, '/');
const STATIC_URL = argv.pretty ? '' : (STATIC_BASE_URL + argv.build + '/');
const STATIC_VERSION = argv.build;

const PROD_DIR = 'dist_prod';
const STATIC_DIR = 'dist_static';
const PRETTY_DIR = 'dist_pretty';

// path for files (mostly index_*.html) with short cache periods
const DIST_PROD_DIR = argv.pretty ? PRETTY_DIR : PROD_DIR;

// path for static resources
const DIST_STATIC_DIR = argv.pretty ? PRETTY_DIR : (STATIC_DIR + '/' + argv.build);

// Broad scene config for Santa Tracker.
const SCENE_CLOSURE_CONFIG = require('./scenes');

// List of scene names to compile.
const SCENE_NAMES = argv.scene ?
    [argv.scene].concat((SCENE_CLOSURE_CONFIG[argv.scene] || {}).dependencies || []) :
    Object.keys(SCENE_CLOSURE_CONFIG);

gulp.task('clean', function() {
  return del([
    '{scenes,sass,elements}/**/*.css',
    '{scenes,sass,elements}/**/*_module.html',
    'scenes/*/*.min.js',
    'js/service/*.min.js'
  ]);
});

gulp.task('rm-dist', function() {
  return del([PROD_DIR, STATIC_DIR, PRETTY_DIR]);
});

gulp.task('sass', function() {
  return gulp.src(SASS_FILES, {base: '.'})  // nb. compile all sass files, it's fast
    .pipe($.sass({outputStyle: 'compressed'}).on('error', $.sass.logError))
    .pipe($.autoprefixer({browsers: AUTOPREFIXER_BROWSERS}))
    .pipe(styleModules('_module'))
    .pipe($.changed('.', {hasChanged: $.changed.compareSha1Digest}))
    .pipe(gulp.dest('.'));
});

gulp.task('compile-santa-api-service', function() {
  changedFlag(API_BASE_URL, 'js/service/service.flag', function() {
    try {
      fs.unlinkSync('js/service/service.min.js');
    } catch (e) {
      // ignored
    }
  });

  return gulp.src(SERVICE_FILES)
    .pipe($.newer('js/service/service.min.js'))
    .pipe($.closureCompiler({
      compilerPath: COMPILER_PATH,
      fileName: 'service.min.js',
      compilerFlags: addCompilerFlagOptions({
        compilation_level: 'SIMPLE_OPTIMIZATIONS',
        // warning_level: 'VERBOSE',
        language_in: 'ECMASCRIPT6_STRICT',
        language_out: 'ECMASCRIPT5_STRICT',
        externs: SHARED_EXTERNS.concat('js/service/externs.js'),
        define: [`crossDomainAjax.BASE="${API_BASE_URL}"`],
        jscomp_warning: [
          // https://github.com/google/closure-compiler/wiki/Warnings
          'accessControls',
          'const',
          'visibility',
        ],
      })
    }))
    .pipe(gulp.dest('js/service'));
});

gulp.task('compile-scenes', function() {
  const closureLibraryPath = path.resolve('components/closure-library/closure/goog');
  const limit = $.limiter(-2);

  // compile each scene, merging them into a single gulp stream as we go
  return SCENE_NAMES.reduce((stream, sceneName) => {
    const config = SCENE_CLOSURE_CONFIG[sceneName];
    const fileName = `${sceneName}-scene.min.js`;
    const dest = `scenes/${sceneName}`;

    let warnings = CLOSURE_SAFE_WARNINGS;
    let warningLevel = 'VERBOSE';
    if (config.typeSafe === false) {
      warnings = CLOSURE_WARNINGS;
      warningLevel = 'DEFAULT';
    }

    // All scenes need the compiler's base.js to get @export support. This is used in compilerFlags
    // since since it's essentially a static library (and to work around gulp-closure-compiler's
    // love of copying files to /tmp). Remove tests last, as the rules seem to be evaluated
    // left-to-right.
    const compilerSrc = [
      closureLibraryPath + (config.closureLibrary ? '/**.js' : '/base.js'),
      `!${closureLibraryPath}/**_test.js`,
    ];

    // Extra closure compiled libraries required by scene. Unfortunately, Closure Compiler does not
    // support standard bash glob '**/*.ext', only '**.ext' which bash/gulp does not support.
    const libraries = (config.libraries || []).map(lib => lib.replace('**/*', '**'));
    compilerSrc.push(...libraries);

    const compilerFlags = addCompilerFlagOptions({
      js: compilerSrc,
      externs: SHARED_EXTERNS,
      closure_entry_point: config.entryPoint,
      compilation_level: 'SIMPLE_OPTIMIZATIONS',
      warning_level: warningLevel,
      language_in: 'ECMASCRIPT6_STRICT',
      language_out: 'ECMASCRIPT5_STRICT',
      process_closure_primitives: null,
      generate_exports: null,
      jscomp_warning: warnings,
      only_closure_dependencies: null,
      rewrite_polyfills: false,
      // scenes namespace themselves to `app.*`. Move this namespace into the global
      // `scenes.sceneName`, unless it's building for a frame. Note that this must be ES5.
      output_wrapper: config.isFrame ? '%output%' :
          `var scenes = scenes || {};\n` +
          `scenes.${sceneName} = scenes.${sceneName} || {};\n` +
          `(function(){var global=window;%output%}).call({app: scenes.${sceneName}});`
    });

    // TODO(samthor): Log the kickoff of this event.
    const compilerStream = $.closureCompiler({
      compilerPath: COMPILER_PATH,
      continueWithWarnings: true,
      fileName,
      compilerFlags,
    });

    return stream.add(gulp.src([`scenes/${sceneName}/js/**/*.js`, 'scenes/shared/js/*.js'])
        .pipe($.newer(`${dest}/${fileName}`))
        .pipe(limit(compilerStream))
        .pipe(gulp.dest(dest)));
  }, mergeStream());
});

function addCompilerFlagOptions(opts) {
  // Add any compiler options specified by command line flags.
  if (argv.pretty) {
    opts.formatting = 'PRETTY_PRINT';
  }
  return opts;
}

gulp.task('build-scene-deps', function() {
  // compile each scene, merging them into a single gulp stream as we go
  return SCENE_NAMES.reduce((stream, sceneName) => {
    const config = SCENE_CLOSURE_CONFIG[sceneName];
    const fileName = sceneName + '-scene.deps.js';
    const dest = '.devmode/scenes/' + sceneName;
    const scripts = [
      'scenes/' + sceneName + '/js/**/*.js',
      'scenes/shared/js/*.js'
    ].concat(config.libraries || []);

    return stream.add(gulp.src(scripts)
        .pipe($.newer(dest + '/' + fileName))
        .pipe($.closureDeps({
          baseDir: '.',
          fileName: fileName,
          prefix: '../../../..'
        }))
        .pipe($.changed(dest, {hasChanged: $.changed.compareSha1Digest}))
        .pipe(gulp.dest(dest)));
  }, mergeStream());
});

gulp.task('create-dev-scenes', function() {
  // compile each scene, merging them into a single gulp stream as we go
  return SCENE_NAMES.reduce((stream, sceneName) => {
    const dest = '.devmode/scenes/' + sceneName;
    return stream.add(
        gulp.src('scenes/' + sceneName + '/' + sceneName + '-scene_en.html')
            .pipe(devScene(sceneName, SCENE_CLOSURE_CONFIG[sceneName]))
            .pipe($.newer(dest + '/index.html'))
            .pipe(gulp.dest(dest))
    );
  }, mergeStream());
});

gulp.task('vulcanize-scenes', ['sass', 'compile-scenes'], function() {
  // Strip all common elements, found in the standard elements import.
  const elementsPath = 'elements/elements_en.html';
  const elementsImports = (function() {
    const r = /href="(.*?)"/g;
    const el = fs.readFileSync(elementsPath, 'utf-8');
    const all = [];
    let out;
    while ((out = r.exec(el))) {
      const raw = out[1];
      const i = path.join(path.dirname(elementsPath), raw);  // use dirname of elements/...
      all.push(i);
    }
    return all;
  }());

  return gulp.src([
      'scenes/*/*-scene*.html',
      // TODO(samthor): Support vulcanizing non-scene HTML (#1679).
      'scenes/postcardly/snowflake-maker/turtle.html',
    ], {base: './'})
    // gulp-vulcanize doesn't currently handle multiple files in multiple
    // directories well right now, so vulcanize them one at a time
    .pipe($.foreach((stream, file) => {
      const dest = path.dirname(path.relative(__dirname, file.path));
      const sceneName = path.basename(dest);
      const closureConfig = SCENE_CLOSURE_CONFIG[sceneName] || {};

      return stream.pipe($.vulcanize({
        stripExcludes: closureConfig.isFrame ? [] : elementsImports,
        inlineScripts: true,
        inlineCss: true,
        stripComments: true,
        dest: dest
      }))
      .pipe($.crisper({scriptInHead: true})) // Separate HTML/JS into separate files.
      .pipe(argv.pretty ? gutil.noop() : $.replace(/window\.DEV ?= ?true.*/, ''))
      .pipe($.if('*.html', i18n_replace({
        strict: !!argv.strict,
        path: '_messages',
      })))
      .pipe(gulp.dest(DIST_STATIC_DIR));
    }));
});

// Vulcanize elements separately, as we want to inline the majority common code
// here.
gulp.task('vulcanize-elements', ['sass', 'compile-santa-api-service'], function() {
  return gulp.src('elements/elements_en.html', {base: './'})
    .pipe($.vulcanize({
      inlineScripts: true,
      inlineCss: true,
      stripComments: true,
      dest: 'elements',
    }))
    .pipe($.crisper({scriptInHead: true})) // Separate HTML/JS into separate files.
    .pipe($.if('*.html', i18n_replace({
      strict: !!argv.strict,
      path: '_messages',
    })))
    .pipe(gulp.dest(DIST_STATIC_DIR));
});

gulp.task('vulcanize', ['vulcanize-scenes', 'vulcanize-elements']);

gulp.task('build-prod', function() {
  const htmlStream = gulp.src(['index.html', 'error.html', 'upgrade.html', 'cast.html'])
    .pipe(argv.pretty ? gutil.noop() : $.replace(/window\.DEV ?= ?true.*/, ''))
    .pipe($.replace('<base href="">', `<base href="${STATIC_URL}">`))
    .pipe($.replace('data-version=""', `data-version="${STATIC_VERSION}"`))
    .pipe(i18n_replace({
      strict: !!argv.strict,
      path: '_messages',
    }))
    .pipe(gulp.dest(DIST_PROD_DIR));

  const jsStream = gulp.src(['sw.js'])
    .pipe($.replace('./STATIC_PATH/', STATIC_URL))
    .pipe($.replace(/const version ?= ?\'\';/, `const version = '${STATIC_VERSION}';`))
    .pipe(gulp.dest(DIST_PROD_DIR));

  return mergeStream(htmlStream, jsStream);
});

gulp.task('build-prod-manifest', function() {
  return gulp.src(['manifest.json'])
    .pipe(i18n_manifest({path: '_messages'}))
    .pipe(gulp.dest(DIST_PROD_DIR));
});

// copy needed assets (images, sounds, polymer elements, etc) to dist directories
gulp.task('copy-assets', ['vulcanize', 'build-prod', 'build-prod-manifest'], function() {
  const staticStream = gulp.src([
    'audio/*',
    'images/*.{png,svg,jpg,gif,ico}',
    'third_party/**',
    'sass/*.css',
    'scenes/**/img/**/*.{png,jpg,svg,gif,cur}',
    'elements/**/img/*.{png,jpg,svg,gif}',
    'components/webcomponentsjs/webcomponents-lite.min.js',
    'js/ccsender.html',
    // TODO(samthor): Better support for custom scenes (#1679).
    'scenes/postcardly/snowflake-maker/{media,third-party}/**',
  ], {base: './'})
    .pipe(gulp.dest(DIST_STATIC_DIR));

  const prodStream = gulp.src([
    'images/og.png',
    'images/*icon*.png',  // nb. duplicated in prod for manifest convenience
  ], {base: './'})
    .pipe(gulp.dest(DIST_PROD_DIR));

  return mergeStream(staticStream, prodStream);
});

// builds a JSON manifest file containing files and hashes
gulp.task('build-contents', ['copy-assets'], function() {
  const stream = file_manifest(STATIC_VERSION, DIST_STATIC_DIR);
  return gulp.src([`${DIST_STATIC_DIR}/**/*`])
    .pipe(stream)
    .pipe(gulp.dest(DIST_STATIC_DIR));
});

// clean + build a distribution version
gulp.task('dist', function(callback) {
  require('run-sequence')('rm-dist', 'copy-assets', 'build-contents', callback);
});

gulp.task('watch', function() {
  gulp.watch(SASS_FILES, ['sass']);

  if (argv.devmode) {
    gulp.watch(CLOSURE_FILES, ['build-scene-deps']);
    gulp.watch('scenes/**/*.html', ['create-dev-scenes']);
  } else {
    gulp.watch(CLOSURE_FILES, ['compile-scenes']);
    gulp.watch(SERVICE_FILES, ['compile-santa-api-service']);
  }
});

gulp.task('serve', ['default', 'watch'], function() {
  const livereloadFiles = ['**/*.css'];

  // Reload on raw js files only in dev mode.
  if (argv.devmode) {
    livereloadFiles.push('scenes/**/*.js', '.devmode/**/*.js', '.devmode/**/index.html');
  } else {
    livereloadFiles.push('**/*.min.js', '**/*.html');
  }

  const browserSync = require('browser-sync').create();
  browserSync.init({
    files: livereloadFiles,
    injectChanges: argv.devmode, // Can not inject css into lazy Polymer scenes.
    port: argv.port,
    server: ['.', '.devmode'],
    startPath: argv.scene && (argv.devmode ? `/scenes/${argv.scene}/` : `/#${argv.scene}`),
    ui: {port: argv.port + 1},
  });
});


gulp.task('default', argv.devmode ?
    ['sass', 'build-scene-deps', 'create-dev-scenes'] :
    ['sass', 'compile-santa-api-service', 'compile-scenes']);

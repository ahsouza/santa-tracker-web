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

'use strict';

goog.provide('app.Lights');

app.Lights = class {
  constructor(el) {
    const numberOfTiles = 9;
    const numberOfLights = 4;

    this.tiles = Array.from({length: numberOfTiles}, (k, v) => v + 1);

    this.lights = Array.from({length: numberOfLights}).map(() => {
      let light = document.createElement('div');
      light.classList.add('scene__light');
      return light;
    })

    this.lights.forEach(light => el.appendChild(light));
    this.active = false;
  }

  setLevel(level) {
    this.active = level.stage === 'stage2';
  }

  onBeat(beat, bpm) {
    if (!this.active) return;

    this.shuffle_(this.tiles);

    this.lights.forEach((light, index) => {
      light.style.backgroundImage = `url(img/stages/disco_${this.tiles[index]}.svg)`;
    });
  }

  shuffle_(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
  }
}

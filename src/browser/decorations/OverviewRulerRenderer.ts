/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorZoneStore, IColorZone, IColorZoneStore } from 'browser/decorations/ColorZoneStore';
import { addDisposableDomListener } from 'browser/Lifecycle';
import { IRenderService } from 'browser/services/Services';
import { Disposable } from 'common/Lifecycle';
import { IBufferService, IDecorationService, IInternalDecoration, IOptionsService } from 'common/services/Services';

// Helper objects to avoid excessive calculation and garbage collection during rendering. These are
// static values for each render and can be accessed using the decoration position as the key.
const drawHeight = {
  full: 0,
  left: 0,
  center: 0,
  right: 0
};
const drawWidth = {
  full: 0,
  left: 0,
  center: 0,
  right: 0
};
const drawX = {
  full: 0,
  left: 0,
  center: 0,
  right: 0
};

export class OverviewRulerRenderer extends Disposable {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private readonly _colorZoneStore: IColorZoneStore = new ColorZoneStore();
  private get _width(): number {
    return this._optionsService.options.overviewRulerWidth || 0;
  }
  private _animationFrame: number | undefined;

  private _shouldUpdateDimensions: boolean | undefined = true;
  private _shouldUpdateAnchor: boolean | undefined = true;
  private _lastKnownBufferLength: number = 0;

  private _containerHeight: number | undefined;

  constructor(
    private readonly _viewportElement: HTMLElement,
    private readonly _screenElement: HTMLElement,
    @IBufferService private readonly _bufferService: IBufferService,
    @IDecorationService private readonly _decorationService: IDecorationService,
    @IRenderService private readonly _renderService: IRenderService,
    @IOptionsService private readonly _optionsService: IOptionsService
  ) {
    super();
    this._canvas = document.createElement('canvas');
    this._canvas.classList.add('xterm-decoration-overview-ruler');
    this._refreshCanvasDimensions();
    this._viewportElement.parentElement?.insertBefore(this._canvas, this._viewportElement);
    const ctx = this._canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Ctx cannot be null');
    } else {
      this._ctx = ctx;
    }
    this._registerDecorationListeners();
    this._registerBufferChangeListeners();
    this._registerDimensionChangeListeners();
  }

  /**
   * On decoration add or remove, redraw
   */
  private _registerDecorationListeners(): void {
    this.register(this._decorationService.onDecorationRegistered(() => this._queueRefresh(undefined, true)));
    this.register(this._decorationService.onDecorationRemoved(() => this._queueRefresh(undefined, true)));
  }

  /**
   * On buffer change, redraw
   * and hide the canvas if the alt buffer is active
   */
  private _registerBufferChangeListeners(): void {
    this.register(this._renderService.onRenderedViewportChange(() => this._queueRefresh()));
    this.register(this._bufferService.buffers.onBufferActivate(() => {
      this._canvas!.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? 'none' : 'block';
    }));
    this.register(this._bufferService.onScroll(() => {
      if (this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length) {
        this._refreshColorZonePadding();
      }
    }));
  }
  /**
   * On dimension change, update canvas dimensions
   * and then redraw
   */
  private _registerDimensionChangeListeners(): void {
    // container height changed
    this.register(this._renderService.onRender((): void => {
      if (!this._containerHeight || this._containerHeight !== this._screenElement.clientHeight) {
        this._queueRefresh(true);
        this._containerHeight = this._screenElement.clientHeight;
      }
    }));
    // overview ruler width changed
    this.register(this._optionsService.onOptionChange(o => {
      if (o === 'overviewRulerWidth') {
        this._queueRefresh(true);
      }
    }));
    // device pixel ratio changed
    this.register(addDisposableDomListener(window, 'resize', () => {
      this._queueRefresh(true);
    }));
    // set the canvas dimensions
    this._queueRefresh(true);
  }

  public override dispose(): void {
    this._canvas?.remove();
    super.dispose();
  }

  private _refreshDrawConstants(): void {
    // width
    const outerWidth = Math.floor(this._canvas.width / 3);
    const innerWidth = Math.ceil(this._canvas.width / 3);
    drawWidth.full = this._canvas.width;
    drawWidth.left = outerWidth;
    drawWidth.center = innerWidth;
    drawWidth.right = outerWidth;
    // height
    drawHeight.full = Math.round(2 * window.devicePixelRatio);
    drawHeight.left = Math.round(6 * window.devicePixelRatio);
    drawHeight.center = Math.round(6 * window.devicePixelRatio);
    drawHeight.right = Math.round(6 * window.devicePixelRatio);
    // x
    drawX.full = 0;
    drawX.left = 0;
    drawX.center = drawWidth.left;
    drawX.right = drawWidth.left + drawWidth.center;
  }

  private _refreshColorZonePadding(): void {
    this._colorZoneStore.setPadding({
      full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * drawHeight.full),
      left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * drawHeight.left),
      center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * drawHeight.center),
      right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * drawHeight.right)
    });
    this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
  }

  private _refreshCanvasDimensions(): void {
    this._canvas.style.width = `${this._width}px`;
    this._canvas.width = Math.round(this._width * window.devicePixelRatio);
    this._canvas.style.height = `${this._screenElement.clientHeight}px`;
    this._canvas.height = Math.round(this._screenElement.clientHeight * window.devicePixelRatio);
    this._refreshDrawConstants();
    this._refreshColorZonePadding();
  }

  private _refreshDecorations(): void {
    if (this._shouldUpdateDimensions) {
      this._refreshCanvasDimensions();
    }
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._colorZoneStore.clear();
    for (const decoration of this._decorationService.decorations) {
      this._colorZoneStore.addDecoration(decoration);
    }
    this._ctx.lineWidth = 1;
    const zones = this._colorZoneStore.zones;
    for (const zone of zones) {
      if (zone.position !== 'full') {
        this._renderColorZone(zone);
      }
    }
    for (const zone of zones) {
      if (zone.position === 'full') {
        this._renderColorZone(zone);
      }
    }
    this._shouldUpdateDimensions = false;
    this._shouldUpdateAnchor = false;
  }

  private _renderColorZone(zone: IColorZone): void {
    // TODO: Is _decorationElements needed?

    this._ctx.fillStyle = zone.color;
    this._ctx.fillRect(
      /* x */ drawX[zone.position || 'full'],
      /* y */ Math.round(
        (this._canvas.height - 1) * // -1 to ensure at least 2px are allowed for decoration on last line
        (zone.startBufferLine / this._bufferService.buffers.active.lines.length) - drawHeight[zone.position || 'full'] / 2
      ),
      /* w */ drawWidth[zone.position || 'full'],
      /* h */ Math.round(
        (this._canvas.height - 1) * // -1 to ensure at least 2px are allowed for decoration on last line
        ((zone.endBufferLine - zone.startBufferLine) / this._bufferService.buffers.active.lines.length) + drawHeight[zone.position || 'full']
      )
    );
  }

  private _queueRefresh(updateCanvasDimensions?: boolean, updateAnchor?: boolean): void {
    this._shouldUpdateDimensions = updateCanvasDimensions || this._shouldUpdateDimensions;
    this._shouldUpdateAnchor = updateAnchor || this._shouldUpdateAnchor;
    if (this._animationFrame !== undefined) {
      return;
    }
    this._animationFrame = window.requestAnimationFrame(() => {
      this._refreshDecorations();
      this._animationFrame = undefined;
    });
  }
}

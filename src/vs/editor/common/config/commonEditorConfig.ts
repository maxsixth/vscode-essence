/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import Event, { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import { Extensions, IConfigurationRegistry, IConfigurationNode } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/platform';
import { DefaultConfig, DEFAULT_INDENTATION, DEFAULT_TRIM_AUTO_WHITESPACE } from 'vs/editor/common/config/defaultConfig';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { EditorLayoutProvider } from 'vs/editor/common/viewLayout/editorLayoutProvider';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { FontInfo, BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Constants } from 'vs/editor/common/core/uint';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';

/**
 * Control what pressing Tab does.
 * If it is false, pressing Tab or Shift-Tab will be handled by the editor.
 * If it is true, pressing Tab or Shift-Tab will move the browser focus.
 * Defaults to false.
 */
export interface ITabFocus {
	onDidChangeTabFocus: Event<boolean>;
	getTabFocusMode(): boolean;
	setTabFocusMode(tabFocusMode: boolean): void;
}

export const TabFocus: ITabFocus = new class {
	private _tabFocus: boolean = false;

	private _onDidChangeTabFocus: Emitter<boolean> = new Emitter<boolean>();
	public onDidChangeTabFocus: Event<boolean> = this._onDidChangeTabFocus.event;

	public getTabFocusMode(): boolean {
		return this._tabFocus;
	}

	public setTabFocusMode(tabFocusMode: boolean): void {
		if (this._tabFocus === tabFocusMode) {
			return;
		}

		this._tabFocus = tabFocusMode;
		this._onDidChangeTabFocus.fire(this._tabFocus);
	}
};

/**
 * Experimental screen reader support toggle
 */
export class GlobalScreenReaderNVDA {

	private static _value = false;
	private static _onChange = new Emitter<boolean>();
	public static onChange: Event<boolean> = GlobalScreenReaderNVDA._onChange.event;

	public static getValue(): boolean {
		return this._value;
	}

	public static setValue(value: boolean): void {
		if (this._value === value) {
			return;
		}
		this._value = value;
		this._onChange.fire(this._value);
	}
}

export class ConfigurationWithDefaults {

	private _editor: editorCommon.IEditorOptions;

	constructor(options: editorCommon.IEditorOptions) {
		this._editor = <editorCommon.IEditorOptions>objects.clone(DefaultConfig.editor);

		this._mergeOptionsIn(options);
	}

	public getEditorOptions(): editorCommon.IEditorOptions {
		return this._editor;
	}

	private _mergeOptionsIn(newOptions: editorCommon.IEditorOptions): void {
		this._editor = objects.mixin(this._editor, newOptions || {});
	}

	public updateOptions(newOptions: editorCommon.IEditorOptions): void {
		// Apply new options
		this._mergeOptionsIn(newOptions);
	}
}

class InternalEditorOptionsHelper {

	constructor() {
	}

	public static createInternalEditorOptions(
		outerWidth: number,
		outerHeight: number,
		opts: editorCommon.IEditorOptions,
		fontInfo: FontInfo,
		editorClassName: string,
		isDominatedByLongLines: boolean,
		lineNumbersDigitCount: number,
		canUseTranslate3d: boolean,
		pixelRatio: number
	): editorCommon.InternalEditorOptions {

		let stopRenderingLineAfter: number;
		if (typeof opts.stopRenderingLineAfter !== 'undefined') {
			stopRenderingLineAfter = toInteger(opts.stopRenderingLineAfter, -1);
		} else {
			stopRenderingLineAfter = 10000;
		}

		let scrollbar = this._sanitizeScrollbarOpts(opts.scrollbar, toFloat(opts.mouseWheelScrollSensitivity, 1));
		let minimap = this._sanitizeMinimapOpts(opts.minimap);

		let glyphMargin = toBoolean(opts.glyphMargin);
		let lineNumbersMinChars = toInteger(opts.lineNumbersMinChars, 1);

		let lineDecorationsWidth: number;
		if (typeof opts.lineDecorationsWidth === 'string' && /^\d+(\.\d+)?ch$/.test(opts.lineDecorationsWidth)) {
			let multiple = parseFloat(opts.lineDecorationsWidth.substr(0, opts.lineDecorationsWidth.length - 2));
			lineDecorationsWidth = multiple * fontInfo.typicalHalfwidthCharacterWidth;
		} else {
			lineDecorationsWidth = toInteger(opts.lineDecorationsWidth, 0);
		}
		if (opts.folding) {
			lineDecorationsWidth += 16;
		}

		let renderLineNumbers: boolean;
		let renderCustomLineNumbers: (lineNumber: number) => string;
		let renderRelativeLineNumbers: boolean;
		{
			let lineNumbers = opts.lineNumbers;
			// Compatibility with old true or false values
			if (<any>lineNumbers === true) {
				lineNumbers = 'on';
			} else if (<any>lineNumbers === false) {
				lineNumbers = 'off';
			}

			if (typeof lineNumbers === 'function') {
				renderLineNumbers = true;
				renderCustomLineNumbers = lineNumbers;
				renderRelativeLineNumbers = false;
			} else if (lineNumbers === 'relative') {
				renderLineNumbers = true;
				renderCustomLineNumbers = null;
				renderRelativeLineNumbers = true;
			} else if (lineNumbers === 'on') {
				renderLineNumbers = true;
				renderCustomLineNumbers = null;
				renderRelativeLineNumbers = false;
			} else {
				renderLineNumbers = false;
				renderCustomLineNumbers = null;
				renderRelativeLineNumbers = false;
			}
		}

		let layoutInfo = EditorLayoutProvider.compute({
			outerWidth: outerWidth,
			outerHeight: outerHeight,
			showGlyphMargin: glyphMargin,
			lineHeight: fontInfo.lineHeight,
			showLineNumbers: renderLineNumbers,
			lineNumbersMinChars: lineNumbersMinChars,
			lineNumbersDigitCount: lineNumbersDigitCount,
			lineDecorationsWidth: lineDecorationsWidth,
			typicalHalfwidthCharacterWidth: fontInfo.typicalHalfwidthCharacterWidth,
			maxDigitWidth: fontInfo.maxDigitWidth,
			verticalScrollbarWidth: scrollbar.verticalScrollbarSize,
			horizontalScrollbarHeight: scrollbar.horizontalScrollbarSize,
			scrollbarArrowSize: scrollbar.arrowSize,
			verticalScrollbarHasArrows: scrollbar.verticalHasArrows,
			minimap: minimap.enabled,
			minimapRenderCharacters: minimap.renderCharacters,
			minimapMaxColumn: minimap.maxColumn,
			pixelRatio: pixelRatio
		});

		let bareWrappingInfo: { isViewportWrapping: boolean; wrappingColumn: number; } = null;
		{
			let wordWrap = opts.wordWrap;
			let wordWrapColumn = toInteger(opts.wordWrapColumn, 1);

			// Compatibility with old true or false values
			if (<any>wordWrap === true) {
				wordWrap = 'on';
			} else if (<any>wordWrap === false) {
				wordWrap = 'off';
			}

			if (isDominatedByLongLines) {
				// Force viewport width wrapping if model is dominated by long lines
				bareWrappingInfo = {
					isViewportWrapping: true,
					wrappingColumn: Math.max(1, layoutInfo.viewportColumn)
				};
			} else if (wordWrap === 'on') {
				bareWrappingInfo = {
					isViewportWrapping: true,
					wrappingColumn: Math.max(1, layoutInfo.viewportColumn)
				};
			} else if (wordWrap === 'bounded') {
				bareWrappingInfo = {
					isViewportWrapping: true,
					wrappingColumn: Math.min(Math.max(1, layoutInfo.viewportColumn), wordWrapColumn)
				};
			} else if (wordWrap === 'wordWrapColumn') {
				bareWrappingInfo = {
					isViewportWrapping: false,
					wrappingColumn: wordWrapColumn
				};
			} else {
				bareWrappingInfo = {
					isViewportWrapping: false,
					wrappingColumn: -1
				};
			}
		}

		let wrappingInfo = new editorCommon.EditorWrappingInfo({
			isViewportWrapping: bareWrappingInfo.isViewportWrapping,
			wrappingColumn: bareWrappingInfo.wrappingColumn,
			wrappingIndent: wrappingIndentFromString(opts.wrappingIndent),
			wordWrapBreakBeforeCharacters: String(opts.wordWrapBreakBeforeCharacters),
			wordWrapBreakAfterCharacters: String(opts.wordWrapBreakAfterCharacters),
			wordWrapBreakObtrusiveCharacters: String(opts.wordWrapBreakObtrusiveCharacters),
		});

		let readOnly = toBoolean(opts.readOnly);

		let tabFocusMode = TabFocus.getTabFocusMode();
		if (readOnly) {
			tabFocusMode = true;
		}


		let renderWhitespace = opts.renderWhitespace;
		// Compatibility with old true or false values
		if (<any>renderWhitespace === true) {
			renderWhitespace = 'boundary';
		} else if (<any>renderWhitespace === false) {
			renderWhitespace = 'none';
		}

		let renderLineHighlight = opts.renderLineHighlight;
		// Compatibility with old true or false values
		if (<any>renderLineHighlight === true) {
			renderLineHighlight = 'line';
		} else if (<any>renderLineHighlight === false) {
			renderLineHighlight = 'none';
		}

		let viewInfo = new editorCommon.InternalEditorViewOptions({
			theme: opts.theme,
			canUseTranslate3d: canUseTranslate3d,
			disableMonospaceOptimizations: (toBoolean(opts.disableMonospaceOptimizations) || toBoolean(opts.fontLigatures)),
			experimentalScreenReader: toBoolean(opts.experimentalScreenReader),
			rulers: toSortedIntegerArray(opts.rulers),
			ariaLabel: String(opts.ariaLabel),
			renderLineNumbers: renderLineNumbers,
			renderCustomLineNumbers: renderCustomLineNumbers,
			renderRelativeLineNumbers: renderRelativeLineNumbers,
			selectOnLineNumbers: toBoolean(opts.selectOnLineNumbers),
			glyphMargin: glyphMargin,
			revealHorizontalRightPadding: toInteger(opts.revealHorizontalRightPadding, 0),
			roundedSelection: toBoolean(opts.roundedSelection),
			overviewRulerLanes: toInteger(opts.overviewRulerLanes, 0, 3),
			cursorBlinking: cursorBlinkingStyleFromString(opts.cursorBlinking),
			mouseWheelZoom: toBoolean(opts.mouseWheelZoom),
			cursorStyle: cursorStyleFromString(opts.cursorStyle),
			hideCursorInOverviewRuler: toBoolean(opts.hideCursorInOverviewRuler),
			scrollBeyondLastLine: toBoolean(opts.scrollBeyondLastLine),
			editorClassName: editorClassName,
			stopRenderingLineAfter: stopRenderingLineAfter,
			renderWhitespace: renderWhitespace,
			renderControlCharacters: toBoolean(opts.renderControlCharacters),
			renderIndentGuides: toBoolean(opts.renderIndentGuides),
			renderLineHighlight: renderLineHighlight,
			scrollbar: scrollbar,
			minimap: minimap,
			fixedOverflowWidgets: toBoolean(opts.fixedOverflowWidgets)
		});

		let contribInfo = new editorCommon.EditorContribOptions({
			selectionClipboard: toBoolean(opts.selectionClipboard),
			hover: toBoolean(opts.hover),
			contextmenu: toBoolean(opts.contextmenu),
			quickSuggestions: toBoolean(opts.quickSuggestions),
			quickSuggestionsDelay: toInteger(opts.quickSuggestionsDelay),
			parameterHints: toBoolean(opts.parameterHints),
			iconsInSuggestions: toBoolean(opts.iconsInSuggestions),
			formatOnType: toBoolean(opts.formatOnType),
			formatOnPaste: toBoolean(opts.formatOnPaste),
			suggestOnTriggerCharacters: toBoolean(opts.suggestOnTriggerCharacters),
			acceptSuggestionOnEnter: toBoolean(opts.acceptSuggestionOnEnter),
			acceptSuggestionOnCommitCharacter: toBoolean(opts.acceptSuggestionOnCommitCharacter),
			snippetSuggestions: opts.snippetSuggestions,
			emptySelectionClipboard: opts.emptySelectionClipboard,
			wordBasedSuggestions: opts.wordBasedSuggestions,
			suggestFontSize: opts.suggestFontSize,
			suggestLineHeight: opts.suggestLineHeight,
			selectionHighlight: toBoolean(opts.selectionHighlight),
			codeLens: opts.referenceInfos && opts.codeLens,
			folding: toBoolean(opts.folding),
			matchBrackets: toBoolean(opts.matchBrackets),
		});

		return new editorCommon.InternalEditorOptions({
			lineHeight: fontInfo.lineHeight, // todo -> duplicated in styling
			readOnly: readOnly,
			wordSeparators: String(opts.wordSeparators),
			autoClosingBrackets: toBoolean(opts.autoClosingBrackets),
			useTabStops: toBoolean(opts.useTabStops),
			tabFocusMode: tabFocusMode,
			dragAndDrop: toBoolean(opts.dragAndDrop),
			layoutInfo: layoutInfo,
			fontInfo: fontInfo,
			viewInfo: viewInfo,
			wrappingInfo: wrappingInfo,
			contribInfo: contribInfo,
		});
	}

	private static _sanitizeScrollbarOpts(raw: editorCommon.IEditorScrollbarOptions, mouseWheelScrollSensitivity: number): editorCommon.InternalEditorScrollbarOptions {

		let visibilityFromString = (visibility: string) => {
			switch (visibility) {
				case 'hidden':
					return ScrollbarVisibility.Hidden;
				case 'visible':
					return ScrollbarVisibility.Visible;
				default:
					return ScrollbarVisibility.Auto;
			}
		};

		let horizontalScrollbarSize = toIntegerWithDefault(raw.horizontalScrollbarSize, 10);
		let verticalScrollbarSize = toIntegerWithDefault(raw.verticalScrollbarSize, 14);
		return new editorCommon.InternalEditorScrollbarOptions({
			vertical: visibilityFromString(raw.vertical),
			horizontal: visibilityFromString(raw.horizontal),

			arrowSize: toIntegerWithDefault(raw.arrowSize, 11),
			useShadows: toBooleanWithDefault(raw.useShadows, true),

			verticalHasArrows: toBooleanWithDefault(raw.verticalHasArrows, false),
			horizontalHasArrows: toBooleanWithDefault(raw.horizontalHasArrows, false),

			horizontalScrollbarSize: horizontalScrollbarSize,
			horizontalSliderSize: toIntegerWithDefault(raw.horizontalSliderSize, horizontalScrollbarSize),

			verticalScrollbarSize: verticalScrollbarSize,
			verticalSliderSize: toIntegerWithDefault(raw.verticalSliderSize, verticalScrollbarSize),

			handleMouseWheel: toBooleanWithDefault(raw.handleMouseWheel, true),
			mouseWheelScrollSensitivity: mouseWheelScrollSensitivity
		});
	}

	private static _sanitizeMinimapOpts(raw: editorCommon.IEditorMinimapOptions): editorCommon.InternalEditorMinimapOptions {
		let maxColumn = toIntegerWithDefault(raw.maxColumn, DefaultConfig.editor.minimap.maxColumn);
		if (maxColumn < 1) {
			maxColumn = 1;
		}
		return new editorCommon.InternalEditorMinimapOptions({
			enabled: toBooleanWithDefault(raw.enabled, DefaultConfig.editor.minimap.enabled),
			renderCharacters: toBooleanWithDefault(raw.renderCharacters, DefaultConfig.editor.minimap.renderCharacters),
			maxColumn: maxColumn,
		});
	}
}

function toBoolean(value: any): boolean {
	return value === 'false' ? false : Boolean(value);
}

function toBooleanWithDefault(value: any, defaultValue: boolean): boolean {
	if (typeof value === 'undefined') {
		return defaultValue;
	}
	return toBoolean(value);
}

function toFloat(source: any, defaultValue: number): number {
	let r = parseFloat(source);
	if (isNaN(r)) {
		r = defaultValue;
	}
	return r;
}

function toInteger(source: any, minimum: number = Constants.MIN_SAFE_SMALL_INTEGER, maximum: number = Constants.MAX_SAFE_SMALL_INTEGER): number {
	let r = parseInt(source, 10);
	if (isNaN(r)) {
		r = 0;
	}
	r = Math.max(minimum, r);
	r = Math.min(maximum, r);
	return r | 0;
}

function toSortedIntegerArray(source: any): number[] {
	if (!Array.isArray(source)) {
		return [];
	}
	let arrSource = <any[]>source;
	let r = arrSource.map(el => toInteger(el));
	r.sort();
	return r;
}

function wrappingIndentFromString(wrappingIndent: string): editorCommon.WrappingIndent {
	if (wrappingIndent === 'indent') {
		return editorCommon.WrappingIndent.Indent;
	} else if (wrappingIndent === 'same') {
		return editorCommon.WrappingIndent.Same;
	} else {
		return editorCommon.WrappingIndent.None;
	}
}

function cursorStyleFromString(cursorStyle: string): editorCommon.TextEditorCursorStyle {
	if (cursorStyle === 'line') {
		return editorCommon.TextEditorCursorStyle.Line;
	} else if (cursorStyle === 'block') {
		return editorCommon.TextEditorCursorStyle.Block;
	} else if (cursorStyle === 'underline') {
		return editorCommon.TextEditorCursorStyle.Underline;
	} else if (cursorStyle === 'line-thin') {
		return editorCommon.TextEditorCursorStyle.LineThin;
	} else if (cursorStyle === 'block-outline') {
		return editorCommon.TextEditorCursorStyle.BlockOutline;
	} else if (cursorStyle === 'underline-thin') {
		return editorCommon.TextEditorCursorStyle.UnderlineThin;
	}
	return editorCommon.TextEditorCursorStyle.Line;
}

function cursorBlinkingStyleFromString(cursorBlinkingStyle: string): editorCommon.TextEditorCursorBlinkingStyle {
	switch (cursorBlinkingStyle) {
		case 'blink':
			return editorCommon.TextEditorCursorBlinkingStyle.Blink;
		case 'smooth':
			return editorCommon.TextEditorCursorBlinkingStyle.Smooth;
		case 'phase':
			return editorCommon.TextEditorCursorBlinkingStyle.Phase;
		case 'expand':
			return editorCommon.TextEditorCursorBlinkingStyle.Expand;
		case 'visible': // maintain compatibility
		case 'solid':
			return editorCommon.TextEditorCursorBlinkingStyle.Solid;
	}
	return editorCommon.TextEditorCursorBlinkingStyle.Blink;
}

function toIntegerWithDefault(source: any, defaultValue: number): number {
	if (typeof source === 'undefined') {
		return defaultValue;
	}
	return toInteger(source);
}

export interface IElementSizeObserver {
	startObserving(): void;
	observe(dimension?: editorCommon.IDimension): void;
	dispose(): void;
	getWidth(): number;
	getHeight(): number;
}

export abstract class CommonEditorConfiguration extends Disposable implements editorCommon.IConfiguration {

	public editor: editorCommon.InternalEditorOptions;
	public editorClone: editorCommon.InternalEditorOptions;

	protected _configWithDefaults: ConfigurationWithDefaults;
	protected _elementSizeObserver: IElementSizeObserver;
	private _isDominatedByLongLines: boolean;
	private _lineNumbersDigitCount: number;

	private _onDidChange = this._register(new Emitter<editorCommon.IConfigurationChangedEvent>());
	public onDidChange: Event<editorCommon.IConfigurationChangedEvent> = this._onDidChange.event;

	constructor(options: editorCommon.IEditorOptions, elementSizeObserver: IElementSizeObserver = null) {
		super();
		this._configWithDefaults = new ConfigurationWithDefaults(options);
		this._elementSizeObserver = elementSizeObserver;
		this._isDominatedByLongLines = false;
		this._lineNumbersDigitCount = 1;
		this.editor = this._computeInternalOptions();
		this.editorClone = this.editor.clone();
		this._register(EditorZoom.onDidChangeZoomLevel(_ => this._recomputeOptions()));
		this._register(TabFocus.onDidChangeTabFocus(_ => this._recomputeOptions()));
	}

	public dispose(): void {
		super.dispose();
	}

	protected _recomputeOptions(): void {
		this._setOptions(this._computeInternalOptions());
	}

	private _setOptions(newOptions: editorCommon.InternalEditorOptions): void {
		if (this.editor && this.editor.equals(newOptions)) {
			return;
		}

		let changeEvent = this.editor.createChangeEvent(newOptions);
		this.editor = newOptions;
		this.editorClone = this.editor.clone();
		this._onDidChange.fire(changeEvent);
	}

	public getRawOptions(): editorCommon.IEditorOptions {
		return this._configWithDefaults.getEditorOptions();
	}

	private _computeInternalOptions(): editorCommon.InternalEditorOptions {
		let opts = this._configWithDefaults.getEditorOptions();

		let editorClassName = this._getEditorClassName(opts.theme, toBoolean(opts.fontLigatures));

		let disableTranslate3d = toBoolean(opts.disableTranslate3d);
		let canUseTranslate3d = this._getCanUseTranslate3d();
		if (disableTranslate3d) {
			canUseTranslate3d = false;
		}

		let bareFontInfo = BareFontInfo.createFromRawSettings(opts);

		return InternalEditorOptionsHelper.createInternalEditorOptions(
			this.getOuterWidth(),
			this.getOuterHeight(),
			opts,
			this.readConfiguration(bareFontInfo),
			editorClassName,
			this._isDominatedByLongLines,
			this._lineNumbersDigitCount,
			canUseTranslate3d,
			this._getPixelRatio()
		);
	}

	public updateOptions(newOptions: editorCommon.IEditorOptions): void {
		this._configWithDefaults.updateOptions(newOptions);
		this._recomputeOptions();
	}

	public setIsDominatedByLongLines(isDominatedByLongLines: boolean): void {
		this._isDominatedByLongLines = isDominatedByLongLines;
		this._recomputeOptions();
	}

	public setMaxLineNumber(maxLineNumber: number): void {
		let digitCount = CommonEditorConfiguration.digitCount(maxLineNumber);
		if (this._lineNumbersDigitCount === digitCount) {
			return;
		}
		this._lineNumbersDigitCount = digitCount;
		this._recomputeOptions();
	}

	private static digitCount(n: number): number {
		var r = 0;
		while (n) {
			n = Math.floor(n / 10);
			r++;
		}
		return r ? r : 1;
	}

	protected abstract _getEditorClassName(theme: string, fontLigatures: boolean): string;

	protected abstract getOuterWidth(): number;

	protected abstract getOuterHeight(): number;

	protected abstract _getCanUseTranslate3d(): boolean;

	protected abstract _getPixelRatio(): number;

	protected abstract readConfiguration(styling: BareFontInfo): FontInfo;
}

const configurationRegistry = <IConfigurationRegistry>Registry.as(Extensions.Configuration);
const editorConfiguration: IConfigurationNode = {
	'id': 'editor',
	'order': 5,
	'type': 'object',
	'title': nls.localize('editorConfigurationTitle', "Editor"),
	'properties': {
		'editor.fontFamily': {
			'type': 'string',
			'default': DefaultConfig.editor.fontFamily,
			'overridable': true,
			'description': nls.localize('fontFamily', "Controls the font family.")
		},
		'editor.fontWeight': {
			'type': 'string',
			'enum': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
			'default': DefaultConfig.editor.fontWeight,
			'overridable': true,
			'description': nls.localize('fontWeight', "Controls the font weight.")
		},
		'editor.fontSize': {
			'type': 'number',
			'default': DefaultConfig.editor.fontSize,
			'overridable': true,
			'description': nls.localize('fontSize', "Controls the font size in pixels.")
		},
		'editor.lineHeight': {
			'type': 'number',
			'default': DefaultConfig.editor.lineHeight,
			'overridable': true,
			'description': nls.localize('lineHeight', "Controls the line height. Use 0 to compute the lineHeight from the fontSize.")
		},
		'editor.lineNumbers': {
			'type': 'string',
			'enum': ['off', 'on', 'relative'],
			'default': DefaultConfig.editor.lineNumbers,
			'overridable': true,
			'description': nls.localize('lineNumbers', "Controls the display of line numbers. Possible values are 'on', 'off', and 'relative'. 'relative' shows the line count from the current cursor position.")
		},
		'editor.rulers': {
			'type': 'array',
			'items': {
				'type': 'number'
			},
			'default': DefaultConfig.editor.rulers,
			'overridable': true,
			'description': nls.localize('rulers', "Columns at which to show vertical rulers")
		},
		'editor.wordSeparators': {
			'type': 'string',
			'default': DefaultConfig.editor.wordSeparators,
			'overridable': true,
			'description': nls.localize('wordSeparators', "Characters that will be used as word separators when doing word related navigations or operations")
		},
		'editor.tabSize': {
			'type': 'number',
			'default': DEFAULT_INDENTATION.tabSize,
			'minimum': 1,
			'description': nls.localize('tabSize', "The number of spaces a tab is equal to. This setting is overriden based on the file contents when `editor.detectIndentation` is on."),
			'errorMessage': nls.localize('tabSize.errorMessage', "Expected 'number'. Note that the value \"auto\" has been replaced by the `editor.detectIndentation` setting.")
		},
		'editor.insertSpaces': {
			'type': 'boolean',
			'default': DEFAULT_INDENTATION.insertSpaces,
			'description': nls.localize('insertSpaces', "Insert spaces when pressing Tab. This setting is overriden based on the file contents when `editor.detectIndentation` is on."),
			'errorMessage': nls.localize('insertSpaces.errorMessage', "Expected 'boolean'. Note that the value \"auto\" has been replaced by the `editor.detectIndentation` setting.")
		},
		'editor.detectIndentation': {
			'type': 'boolean',
			'default': DEFAULT_INDENTATION.detectIndentation,
			'description': nls.localize('detectIndentation', "When opening a file, `editor.tabSize` and `editor.insertSpaces` will be detected based on the file contents.")
		},
		'editor.roundedSelection': {
			'type': 'boolean',
			'default': DefaultConfig.editor.roundedSelection,
			'overridable': true,
			'description': nls.localize('roundedSelection', "Controls if selections have rounded corners")
		},
		'editor.scrollBeyondLastLine': {
			'type': 'boolean',
			'default': DefaultConfig.editor.scrollBeyondLastLine,
			'overridable': true,
			'description': nls.localize('scrollBeyondLastLine', "Controls if the editor will scroll beyond the last line")
		},
		'editor.minimap.enabled': {
			'type': 'boolean',
			'default': DefaultConfig.editor.minimap.enabled,
			'description': nls.localize('minimap.enabled', "Controls if the minimap is shown")
		},
		'editor.minimap.renderCharacters': {
			'type': 'boolean',
			'default': DefaultConfig.editor.minimap.renderCharacters,
			'description': nls.localize('minimap.renderCharacters', "Render the actual characters on a line (as opposed to color blocks)")
		},
		'editor.minimap.maxColumn': {
			'type': 'number',
			'default': DefaultConfig.editor.minimap.maxColumn,
			'description': nls.localize('minimap.maxColumn', "Limit the width of the minimap to render at most a certain number of columns")
		},
		'editor.wordWrap': {
			'type': 'string',
			'enum': ['off', 'on', 'wordWrapColumn', 'bounded'],
			'enumDescriptions': [
				nls.localize('wordWrap.off', "Lines will never wrap."),
				nls.localize('wordWrap.on', "Lines will wrap at the viewport width."),
				nls.localize('wordWrap.wordWrapColumn', "Lines will wrap at `editor.wordWrapColumn`."),
				nls.localize('wordWrap.bounded', "Lines will wrap at the minimum of viewport and `editor.wordWrapColumn`."),
			],
			'default': DefaultConfig.editor.wordWrap,
			'description': nls.localize('wordWrap', "Controls how lines should wrap. Can be:\n - 'off' (disable wrapping),\n - 'on' (viewport wrapping),\n - 'wordWrapColumn' (wrap at `editor.wordWrapColumn`) or\n - 'bounded' (wrap at minimum of viewport and `editor.wordWrapColumn`).")
		},
		'editor.wordWrapColumn': {
			'type': 'integer',
			'default': DefaultConfig.editor.wordWrapColumn,
			'minimum': 1,
			'description': nls.localize('wordWrapColumn', "Controls the wrapping column of the editor when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.")
		},
		'editor.wrappingIndent': {
			'type': 'string',
			'enum': ['none', 'same', 'indent'],
			'default': DefaultConfig.editor.wrappingIndent,
			'overridable': true,
			'description': nls.localize('wrappingIndent', "Controls the indentation of wrapped lines. Can be one of 'none', 'same' or 'indent'.")
		},
		'editor.mouseWheelScrollSensitivity': {
			'type': 'number',
			'default': DefaultConfig.editor.mouseWheelScrollSensitivity,
			'overridable': true,
			'description': nls.localize('mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events")
		},
		'editor.quickSuggestions': {
			'type': 'boolean',
			'default': DefaultConfig.editor.quickSuggestions,
			'overridable': true,
			'description': nls.localize('quickSuggestions', "Controls if quick suggestions should show up or not while typing")
		},
		'editor.quickSuggestionsDelay': {
			'type': 'integer',
			'default': DefaultConfig.editor.quickSuggestionsDelay,
			'minimum': 0,
			'overridable': true,
			'description': nls.localize('quickSuggestionsDelay', "Controls the delay in ms after which quick suggestions will show up")
		},
		'editor.parameterHints': {
			'type': 'boolean',
			'default': DefaultConfig.editor.parameterHints,
			'overridable': true,
			'description': nls.localize('parameterHints', "Enables parameter hints")
		},
		'editor.autoClosingBrackets': {
			'type': 'boolean',
			'default': DefaultConfig.editor.autoClosingBrackets,
			'overridable': true,
			'description': nls.localize('autoClosingBrackets', "Controls if the editor should automatically close brackets after opening them")
		},
		'editor.formatOnType': {
			'type': 'boolean',
			'default': DefaultConfig.editor.formatOnType,
			'overridable': true,
			'description': nls.localize('formatOnType', "Controls if the editor should automatically format the line after typing")
		},
		'editor.formatOnPaste': {
			'type': 'boolean',
			'default': DefaultConfig.editor.formatOnPaste,
			'overridable': true,
			'description': nls.localize('formatOnPaste', "Controls if the editor should automatically format the pasted content. A formatter must be available and the formatter should be able to format a range in a document.")
		},
		'editor.suggestOnTriggerCharacters': {
			'type': 'boolean',
			'default': DefaultConfig.editor.suggestOnTriggerCharacters,
			'overridable': true,
			'description': nls.localize('suggestOnTriggerCharacters', "Controls if suggestions should automatically show up when typing trigger characters")
		},
		'editor.acceptSuggestionOnEnter': {
			'type': 'boolean',
			'default': DefaultConfig.editor.acceptSuggestionOnEnter,
			'overridable': true,
			'description': nls.localize('acceptSuggestionOnEnter', "Controls if suggestions should be accepted on 'Enter' - in addition to 'Tab'. Helps to avoid ambiguity between inserting new lines or accepting suggestions.")
		},
		'editor.acceptSuggestionOnCommitCharacter': {
			'type': 'boolean',
			'default': DefaultConfig.editor.acceptSuggestionOnCommitCharacter,
			'overridable': true,
			'description': nls.localize('acceptSuggestionOnCommitCharacter', "Controls if suggestions should be accepted on commit characters. For instance in JavaScript the semi-colon (';') can be a commit character that accepts a suggestion and types that character.")
		},
		'editor.snippetSuggestions': {
			'type': 'string',
			'enum': ['top', 'bottom', 'inline', 'none'],
			'default': DefaultConfig.editor.snippetSuggestions,
			'overridable': true,
			'description': nls.localize('snippetSuggestions', "Controls whether snippets are shown with other suggestions and how they are sorted.")
		},
		'editor.emptySelectionClipboard': {
			'type': 'boolean',
			'default': DefaultConfig.editor.emptySelectionClipboard,
			'overridable': true,
			'description': nls.localize('emptySelectionClipboard', "Controls whether copying without a selection copies the current line.")
		},
		'editor.wordBasedSuggestions': {
			'type': 'boolean',
			'default': DefaultConfig.editor.wordBasedSuggestions,
			'overridable': true,
			'description': nls.localize('wordBasedSuggestions', "Enable word based suggestions.")
		},
		'editor.suggestFontSize': {
			'type': 'integer',
			'default': 0,
			'minimum': 0,
			'overridable': true,
			'description': nls.localize('suggestFontSize', "Font size for the suggest widget")
		},
		'editor.suggestLineHeight': {
			'type': 'integer',
			'default': 0,
			'minimum': 0,
			'overridable': true,
			'description': nls.localize('suggestLineHeight', "Line height for the suggest widget")
		},
		'editor.selectionHighlight': {
			'type': 'boolean',
			'default': DefaultConfig.editor.selectionHighlight,
			'overridable': true,
			'description': nls.localize('selectionHighlight', "Controls whether the editor should highlight similar matches to the selection")
		},
		'editor.overviewRulerLanes': {
			'type': 'integer',
			'default': 3,
			'overridable': true,
			'description': nls.localize('overviewRulerLanes', "Controls the number of decorations that can show up at the same position in the overview ruler")
		},
		'editor.cursorBlinking': {
			'type': 'string',
			'enum': ['blink', 'smooth', 'phase', 'expand', 'solid'],
			'default': DefaultConfig.editor.cursorBlinking,
			'overridable': true,
			'description': nls.localize('cursorBlinking', "Control the cursor animation style, possible values are 'blink', 'smooth', 'phase', 'expand' and 'solid'")
		},
		'editor.mouseWheelZoom': {
			'type': 'boolean',
			'default': DefaultConfig.editor.mouseWheelZoom,
			'overridable': true,
			'description': nls.localize('mouseWheelZoom', "Zoom the font of the editor when using mouse wheel and holding Ctrl")
		},
		'editor.cursorStyle': {
			'type': 'string',
			'enum': ['block', 'block-outline', 'line', 'line-thin', 'underline', 'underline-thin'],
			'default': DefaultConfig.editor.cursorStyle,
			'description': nls.localize('cursorStyle', "Controls the cursor style, accepted values are 'block', 'block-outline', 'line', 'line-thin', 'underline' and 'underline-thin'")
		},
		'editor.fontLigatures': {
			'type': 'boolean',
			'default': DefaultConfig.editor.fontLigatures,
			'overridable': true,
			'description': nls.localize('fontLigatures', "Enables font ligatures")
		},
		'editor.hideCursorInOverviewRuler': {
			'type': 'boolean',
			'default': DefaultConfig.editor.hideCursorInOverviewRuler,
			'overridable': true,
			'description': nls.localize('hideCursorInOverviewRuler', "Controls if the cursor should be hidden in the overview ruler.")
		},
		'editor.renderWhitespace': {
			'type': 'string',
			'enum': ['none', 'boundary', 'all'],
			default: DefaultConfig.editor.renderWhitespace,
			'overridable': true,
			description: nls.localize('renderWhitespace', "Controls how the editor should render whitespace characters, possibilities are 'none', 'boundary', and 'all'. The 'boundary' option does not render single spaces between words.")
		},
		'editor.renderControlCharacters': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderControlCharacters,
			'overridable': true,
			description: nls.localize('renderControlCharacters', "Controls whether the editor should render control characters")
		},
		'editor.renderIndentGuides': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderIndentGuides,
			'overridable': true,
			description: nls.localize('renderIndentGuides', "Controls whether the editor should render indent guides")
		},
		'editor.renderLineHighlight': {
			'type': 'string',
			'enum': ['none', 'gutter', 'line', 'all'],
			default: DefaultConfig.editor.renderLineHighlight,
			'overridable': true,
			description: nls.localize('renderLineHighlight', "Controls how the editor should render the current line highlight, possibilities are 'none', 'gutter', 'line', and 'all'.")
		},
		'editor.codeLens': {
			'type': 'boolean',
			'default': DefaultConfig.editor.codeLens,
			'overridable': true,
			'description': nls.localize('codeLens', "Controls if the editor shows code lenses")
		},
		'editor.folding': {
			'type': 'boolean',
			'default': DefaultConfig.editor.folding,
			'overridable': true,
			'description': nls.localize('folding', "Controls whether the editor has code folding enabled")
		},
		'editor.matchBrackets': {
			'type': 'boolean',
			'default': DefaultConfig.editor.matchBrackets,
			'description': nls.localize('matchBrackets', "Highlight matching brackets when one of them is selected.")
		},
		'editor.glyphMargin': {
			'type': 'boolean',
			'default': DefaultConfig.editor.glyphMargin,
			'overridable': true,
			'description': nls.localize('glyphMargin', "Controls whether the editor should render the vertical glyph margin. Glyph margin is mostly used for debugging.")
		},
		'editor.useTabStops': {
			'type': 'boolean',
			'default': DefaultConfig.editor.useTabStops,
			'overridable': true,
			'description': nls.localize('useTabStops', "Inserting and deleting whitespace follows tab stops")
		},
		'editor.trimAutoWhitespace': {
			'type': 'boolean',
			'default': DEFAULT_TRIM_AUTO_WHITESPACE,
			'description': nls.localize('trimAutoWhitespace', "Remove trailing auto inserted whitespace")
		},
		'editor.stablePeek': {
			'type': 'boolean',
			'default': false,
			'overridable': true,
			'description': nls.localize('stablePeek', "Keep peek editors open even when double clicking their content or when hitting Escape.")
		},
		'editor.dragAndDrop': {
			'type': 'boolean',
			'default': DefaultConfig.editor.dragAndDrop,
			'description': nls.localize('dragAndDrop', "Controls if the editor should allow to move selections via drag and drop.")
		},
		'diffEditor.renderSideBySide': {
			'type': 'boolean',
			'default': true,
			'overridable': true,
			'description': nls.localize('sideBySide', "Controls if the diff editor shows the diff side by side or inline")
		},
		'diffEditor.ignoreTrimWhitespace': {
			'type': 'boolean',
			'default': true,
			'overridable': true,
			'description': nls.localize('ignoreTrimWhitespace', "Controls if the diff editor shows changes in leading or trailing whitespace as diffs")
		},
		'diffEditor.renderIndicators': {
			'type': 'boolean',
			'default': true,
			'overridable': true,
			'description': nls.localize('renderIndicators', "Controls if the diff editor shows +/- indicators for added/removed changes")
		}
	}
};

if (platform.isLinux) {
	editorConfiguration['properties']['editor.selectionClipboard'] = {
		'type': 'boolean',
		'default': DefaultConfig.editor.selectionClipboard,
		'description': nls.localize('selectionClipboard', "Controls if the Linux primary clipboard should be supported.")
	};
}

configurationRegistry.registerConfiguration(editorConfiguration);

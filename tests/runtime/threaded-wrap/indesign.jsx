// Runs only against a new, invisible document. The host supplies a fresh directory.
function runStudy(spec, directory) {
  var doc = app.documents.add(false),
    frames = [],
    shapes = [],
    flow;
  function readFrames() {
    var result = [];
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      result.push(String(frame.contents));
    }
    return result;
  }
  function encode(v) {
    if (v === null) return 'null';
    if (typeof v === 'string')
      return (
        '"' +
        v
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t') +
        '"'
      );
    if (typeof v !== 'object') return String(v);
    var entries = [],
      k;
    if (v instanceof Array) {
      for (k = 0; k < v.length; k++) entries.push(encode(v[k]));
      return '[' + entries.join(',') + ']';
    }
    for (k in v) if (v.hasOwnProperty(k)) entries.push(encode(k) + ':' + encode(v[k]));
    return '{' + entries.join(',') + '}';
  }
  function measure(action) {
    var start = $.hiresTimer;
    action();
    flow.recompose();
    var tail = String(frames[frames.length - 1].contents);
    var ms = $.hiresTimer / 1000,
      texts = readFrames();
    if (tail !== texts[texts.length - 1]) throw Error('Last frame changed after recomposition');
    return { ms: ms, frames: texts, overset: flow.overflows };
  }
  try {
    doc.documentPreferences.facingPages = false;
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
    doc.documentPreferences.pageWidth = spec.width + 'pt';
    doc.documentPreferences.pageHeight = spec.height + 'pt';
    var font = app.fonts.itemByName('CMU Serif\tRoman');
    if (!font.isValid) throw Error('Install CMU Serif Roman to run the comparison');
    doc.textDefaults.appliedFont = font;
    doc.textDefaults.fontStyle = 'Roman';
    doc.textDefaults.pointSize = spec.size;
    doc.textDefaults.leading = spec.leading;
    for (var p = 0; p < spec.pages.length; p++) {
      var page = p ? doc.pages.add() : doc.pages[0],
        layout = spec.pages[p];
      if (layout.height !== spec.height)
        page.resize(
          CoordinateSpaces.INNER_COORDINATES,
          AnchorPoint.TOP_LEFT_ANCHOR,
          ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH,
          [spec.width, layout.height]
        );
      for (var f = 0; f < layout.frames.length; f++) {
        var bounds = layout.frames[f],
          frame = page.textFrames.add();
        frame.geometricBounds = [bounds.y, bounds.x, bounds.y + bounds.h, bounds.x + bounds.w];
        frame.textFramePreferences.insetSpacing = 0;
        frame.textFramePreferences.firstBaselineOffset = FirstBaseline.FIXED_HEIGHT;
        frame.textFramePreferences.minimumFirstBaselineOffset = 12;
        if (frames.length) frames[frames.length - 1].nextTextFrame = frame;
        frames.push(frame.getElements()[0]);
      }
      for (var m = 0; m < layout.masks.length; m++) {
        var shape = page.polygons.add(),
          mask = layout.masks[m];
        shape.paths[0].entirePath = mask.points;
        shape.strokeWeight = 0;
        shape.place(new File(directory + '/Links/Weave-' + (mask.art + 1) + '.png'));
        shape.fit(FitOptions.FILL_PROPORTIONALLY);
        shape.fit(FitOptions.CENTER_CONTENT);
        var wrap = shape.textWrapPreferences;
        wrap.textWrapMode = TextWrapModes.CONTOUR;
        wrap.contourOptions.contourType = ContourOptionsTypes.GRAPHIC_FRAME;
        wrap.textWrapOffset = [0, 0, 0, 0];
        wrap.textWrapSide = TextWrapSideOptions.BOTH_SIDES;
        shapes.push(shape.getElements()[0]);
      }
    }
    flow = frames[0].parentStory;
    flow.contents = spec.paragraphs.join('\r');
    var pars = flow.paragraphs.everyItem();
    pars.hyphenation = false;
    pars.justification = Justification.LEFT_ALIGN;
    pars.spaceBefore = 0;
    pars.spaceAfter = 0;
    pars.composer = 'Adobe Paragraph Composer';
    pars.keepAllLinesTogether = false;
    pars.keepWithNext = 0;
    flow.recompose();
    var base = readFrames(),
      source = spec.paragraphs.join('\r');
    if (base.join('') !== source || flow.overflows) throw Error('Incomplete baseline');
    var report = {
      version: String(app.version),
      font: font.postscriptName,
      baseline: base,
      baselineOverset: flow.overflows,
      edits: [],
      move: null
    };
    function restored() {
      flow.recompose();
      if (readFrames().join('|') !== base.join('|')) throw Error('Frame breaks failed to restore');
    }
    for (var n = 0; n < spec.edits.length; n++) {
      var edit = spec.edits[n];
      report.edits.push(
        measure(function () {
          flow.insertionPoints[0].contents = edit;
        })
      );
      var sample = report.edits[n];
      if (sample.frames.join('') !== edit + source || sample.overset)
        throw Error('Incomplete edit');
      for (var j = 0; j < frames.length; j++)
        if (!base[j] || sample.frames[j] === base[j])
          throw Error('Expected reflow through frame ' + j);
      flow.characters.itemByRange(0, edit.length - 1).remove();
      restored();
    }
    report.move = measure(function () {
      shapes[0].move(undefined, ['18pt', '0pt']);
    });
    shapes[0].move(undefined, ['-18pt', '0pt']);
    restored();
    doc.save(new File(directory + '/Contour study.indd'));
    doc.close(SaveOptions.NO);
    doc = app.open(new File(directory + '/Contour study.indd'), false);
    if (
      doc.pages.length !== spec.pages.length ||
      doc.links.length !== shapes.length ||
      doc.stories.length !== 1 ||
      doc.stories[0].textContainers.length !== frames.length ||
      String(doc.stories[0].contents) !== source
    )
      throw Error('Saved InDesign layout failed to reopen intact');
    for (var k = 0; k < doc.links.length; k++)
      if (doc.links[k].status !== LinkStatus.NORMAL)
        throw Error('Missing image link: ' + doc.links[k].name);
    var file = new File(directory + '/indesign.json');
    file.encoding = 'UTF-8';
    if (!file.open('w')) throw Error('Cannot write observations');
    file.write(encode(report));
    file.close();
  } catch (e) {
    throw Error(String(e) + ' (fixture line ' + e.line + ')');
  } finally {
    if (doc.isValid) doc.close(SaveOptions.NO);
  }
}

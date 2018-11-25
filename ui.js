const INITIALIZE = 0;
const GET_PROBABILITIES = 1;
const GET_PROBABILITIES_PREVIEW = 2;
const IMPORT_PROBABILITIES = 3;
const EXPORT_PROBABILITIES = 4;
const CLEAR_CACHE = 5;
const GET_ID = 6;

var previewMode = false;
var hideMode = false;
// swap == false: winners are rows, swap == true: winners are columns
var swap = false;

var config;
var selectedSeason = [];
var teamsW;
var teamsR;
var attrW;
var attrR;
var potSize;
// drawn{W,R}[i] == true if team i has already been drawn
var drawnW = [];
var drawnR = [];
// matched[i] == j if teams i and j are matched
var matched = [];
var drawHistory = [];
var activeDownload;
var precomputedSeasons = new Set();
var importedLimit = {};
var ignoreClicks = true;

// check if browser supports used js features
if (typeof(XPathResult) == 'undefined' || typeof(Worker) == 'undefined') {
	document.getElementById('cldraw-browser').style.display = '';
} else {
	var calculator = new Worker('cldraw.js');

	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			config = this.responseXML;
			initialize();
		}
	};
	xhr.open('GET', 'config.xml');
	xhr.send();
}


function initialize(competition, season) {
	ignoreClicks = true;
	teamsW = [];
	teamsR = [];
	attrW = [];
	attrR = [];

	// select first config entry unless competition/season is explicitly specified
	if (competition === undefined) {
		competition = config.evaluate('//teams[1]/@competition', config, null, XPathResult.STRING_TYPE, null).stringValue;
	}
	if (season === undefined) {
		season = config.evaluate('//teams[@competition = "' + competition + '"][1]/@season', config, null, XPathResult.STRING_TYPE, null).stringValue;
	}

	// load teams from config
	predicates = '[../@competition = "' + competition + '"][../@season = "' + season + '"]';
	selectedSeason = [competition, season];
	var iterator = config.evaluate('//winners' + predicates + '/team', config, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
	var team = iterator.iterateNext();
	while (team) {
		teamsW.push(team.textContent);
		attrW.push([team.getAttribute('group'), team.getAttribute('country')]);
		team = iterator.iterateNext();
	}
	iterator = config.evaluate('//runners-up' + predicates + '/team', config, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
	team = iterator.iterateNext();
	while (team) {
		teamsR.push(team.textContent);
		attrR.push([team.getAttribute('group'), team.getAttribute('country')]);
		team = iterator.iterateNext();
	}
	potSize = attrW.length;

	for (var i = 0; i < potSize; i++) {
		drawnW[i] = false;
		drawnR[i] = false;
		matched[i] = -1;
	}
	drawHistory = [];
	createTable();
	showEditorButtons();
	adjustSizes(competition, season);
	createCompetitions();
	createSeasons(competition);
	removeButtons();
	updateFixtures();
	window.addEventListener('resize', autoResizeTable, false);
	autoResizeTable();

	// terminate web worker and spawn a new one if there is an ongoing expensive computation
	if (document.getElementById('cldraw-computation-running').style.display === '') {
		calculator.terminate();
		calculator = new Worker('cldraw.js');
		precomputedSeasons = new Set();
		importedLimit = {};
		document.getElementById('cldraw-computation-running').style.display = 'none';
	}
	document.getElementById('cldraw-computation-running2').style.display = 'none';

	if (activeDownload != null) {
		activeDownload.abort();
		activeDownload = null;
	}
	document.getElementById('cldraw-dlprogress').style.display = 'none';

	calculator.postMessage([INITIALIZE, attrW, attrR]);

	if (previewMode) {
		document.getElementById('button-preview').classList.add('active');
	} else {
		document.getElementById('button-preview').classList.remove('active');
	}
	if (hideMode) {
		document.getElementById('button-hide').classList.add('active');
	} else {
		document.getElementById('button-hide').classList.remove('active');
	}
	document.getElementById('button-dl').style.display = 'none';

	if (potSize > 12) {
		// check if precomputed probabilities are available
		calculator.postMessage([GET_ID]);
		calculator.onmessage = function(e) {
			if (e.data[1] === true) {
				ignoreClicks = false;
				reset();
			} else {
				document.getElementById('cldraw-computation').style.display = '';
				document.getElementById('cldraw-computation-download').classList.add('disabled');
				document.getElementById('cldraw-dlbadge').innerHTML = 'checking availability...';
				document.getElementById('cldraw-dlsize').innerHTML = '';
				var filename = 'probabilities/' + e.data[0] + '.json';
				var xhr = new XMLHttpRequest();
				xhr.open('HEAD', filename);
				xhr.onreadystatechange = function() {
					if (xhr.status != 200) {
						document.getElementById('cldraw-computation-download').classList.add('disabled');
						document.getElementById('cldraw-dlbadge').innerHTML = 'not available';
						document.getElementById('cldraw-dlsize').innerHTML = '';
					} else {
						var contentLength = xhr.getResponseHeader('Content-Length');
						if (contentLength != null) {
							document.getElementById('cldraw-dlsize').innerHTML = '(' + (contentLength / 1000000).toFixed(1) + ' MB)';
						} else {
							document.getElementById('cldraw-dlsize').innerHTML = '(ca. 5 MB)';
						}
						document.getElementById('cldraw-computation-download').classList.remove('disabled');
						document.getElementById('cldraw-dlbadge').innerHTML = 'recommended';
					}
				};
				xhr.send();
			}
		}
	} else {
		ignoreClicks = false;
		reset();
	}
}


function createTable() {
	var table = document.getElementById('cldraw-table');
	var buttonShrink = document.getElementById('button-shrink');
	if (buttonShrink == null) {
		buttonShrink = document.createElement('button');
		buttonShrink.id = 'button-shrink';
		buttonShrink.classList.add('btn');
		buttonShrink.classList.add('btn-default');
		buttonShrink.appendChild(document.createTextNode('－'));
		buttonShrink.addEventListener('click', resizeTable.bind(null, false), false);
	}
	var buttonEnlarge = document.getElementById('button-enlarge');
	if (buttonEnlarge == null) {
		buttonEnlarge = document.createElement('button');
		buttonEnlarge.id = 'button-enlarge';
		buttonEnlarge.classList.add('btn');
		buttonEnlarge.classList.add('btn-default');
		buttonEnlarge.appendChild(document.createTextNode('＋'));
		buttonEnlarge.addEventListener('click', resizeTable.bind(null, true), false);
	}
	document.getElementById('cldraw-impossible').style.display = 'none';

	while (table.firstChild) {
		table.removeChild(table.firstChild);
	}
	var thead = document.createElement('thead');
	var tr = document.createElement('tr');
	var th = document.createElement('th');
	tr.appendChild(th);
	var div = document.createElement('div');
	div.classList.add('btn-group');
	div.classList.add('btn-group-xs');
	div.role = 'group';
	div.appendChild(buttonShrink);
	div.appendChild(buttonEnlarge);
	th.appendChild(div);

	for (var i = 0; i < potSize; i++) {
		th = document.createElement('th');
		if (!swap) {
			th.appendChild(document.createTextNode(teamsR[i]));
		} else {
			th.appendChild(document.createTextNode(teamsW[i]));
		}
		th.scope = 'col';
		tr.appendChild(th);
	}
	thead.appendChild(tr);

	var tbody = document.createElement('tbody');
	for (var i = 0; i < potSize; i++) {
		var tr = document.createElement('tr');
		var th = document.createElement('th');
		th.scope = 'row';
		if (!swap) {
			th.appendChild(document.createTextNode(teamsW[i]));
		} else {
			th.appendChild(document.createTextNode(teamsR[i]));
		}
		tr.appendChild(th);
		for (var j = 0; j < potSize; j++) {
			var td = document.createElement('td');
			td.style.textAlign = 'center';
			td.appendChild(document.createTextNode('\u231B'));
			tr.appendChild(td);
		}
		tbody.appendChild(tr);
	}

	table.appendChild(thead);
	table.appendChild(tbody);
}

// only show team editor buttons if the loaded configuration is a sorted cl/el config with group names A...H/L
function showEditorButtons() {
	document.getElementById('button-editor').style.display = 'none';
	document.getElementById('cldraw-seasons-separator').style.display = 'none';
	document.getElementById('cldraw-add-season').style.display = 'none';
	for (var i = 0; i < potSize; i++) {
		if (i < 12) {
			if (attrW[i][0] !== String.fromCharCode(65 + i) || attrR[i][0] !== String.fromCharCode(65 + i)) {
				return;
			}
		} else {
			if ((attrW[i][0] !== '' && attrW[i][0] != null) || (attrR[i][0] !== '' && attrR[i][0] != null)) {
				return;
			}
		}
	}
	document.getElementById('button-editor').style.display = '';
	document.getElementById('cldraw-seasons-separator').style.display = '';
	document.getElementById('cldraw-add-season').style.display = '';
}


function createEditor(empty) {
	var editor = document.getElementById('cldraw-editor-groups');
	while (editor.children.length > potSize) {
		editor.removeChild(editor.lastChild);
	}
	while (editor.children.length < potSize) {
		editor.appendChild(editor.firstElementChild.cloneNode(true));
	}
	for (var i = 0; i < potSize; i++) {
		var p = document.getElementsByClassName('cldraw-editor-label')[i];
		if (i < 12) {
			p.innerHTML = 'Group ' + String.fromCharCode(65 + i) + ':';
		} else {
			p.innerHTML = 'CL ' + (i - 11) + ':';
		}
		var winner = document.getElementsByClassName('cldraw-winner')[i];
		var winnerCountry = document.getElementsByClassName('cldraw-winner-country')[i];
		var runnerUp = document.getElementsByClassName('cldraw-runner-up')[i];
		var runnerUpCountry = document.getElementsByClassName('cldraw-runner-up-country')[i];
		if (!empty) {
			winner.value = teamsW[i];
			winnerCountry.value = attrW[i][1];
			runnerUp.value = teamsR[i];
			runnerUpCountry.value = attrR[i][1];
		} else {
			winner.value = '';
			winnerCountry.value = '';
			runnerUp.value = '';
			runnerUpCountry.value = '';
		}
	}
	if (!empty) {
		document.getElementById('cldraw-editor-season').value = selectedSeason[1];
	} else {
		document.getElementById('cldraw-editor-season').value = "";
	}
}


function createCompetitions() {
	var buttonList = document.getElementById('cldraw-competitions');
	while (buttonList.firstChild) {
		buttonList.removeChild(buttonList.firstChild);
	}
	var iterator = config.evaluate('//competition', config, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
	competition = iterator.iterateNext();
	while (competition) {
		var button = document.createElement('li');
		button.id = ('competition-' + competition.getAttribute('id'));
		var a = document.createElement('a');
		a.setAttribute("role", "button");
		var text = document.createTextNode(competition.getElementsByTagName('name')[0].textContent);
		a.appendChild(text);
		button.appendChild(a);
		button.addEventListener('click', createSeasons.bind(null, competition.getAttribute('id')), false);
		buttonList.appendChild(button);
		competition = iterator.iterateNext();
	}
}


function createSeasons(competition) {
	var buttons= document.getElementById('cldraw-competitions').children;
	for (var i = 0; i < buttons.length; i++) {
		if (buttons[i].id == 'competition-' + competition) {
			buttons[i].classList.add('active');
		} else {
			buttons[i].classList.remove('active');
		}
	}
	var buttonList = document.getElementById('cldraw-seasons');
	while (buttonList.firstChild.id !== 'cldraw-seasons-separator') {
		buttonList.removeChild(buttonList.firstChild);
	}
	var seasonSeparator = document.getElementById('cldraw-seasons-separator');
	var iterator = config.evaluate('//teams[@competition = "' + competition + '"]/@season', config, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
	season = iterator.iterateNext();

	if (competition != selectedSeason[0]) {
		initialize(competition, season.textContent);
	}

	while (season) {
		var button = document.createElement('li');
		button.id = ('season-' + competition + '-' + season.textContent);
		if (competition == selectedSeason[0] && season.textContent == selectedSeason[1]) {
			button.classList.add('active');
		}
		var a = document.createElement('a');
		a.setAttribute("role", "button");
		var text = document.createTextNode(season.textContent);
		a.appendChild(text);
		button.appendChild(a);
		button.addEventListener('click', initialize.bind(null, competition, season.textContent), false);
		buttonList.insertBefore(button, seasonSeparator);
		season = iterator.iterateNext();
	}
}


function adjustSizes(competition, season) {
	var short = config.evaluate('//competition[@id = "' + competition + '"]/short', config, null, XPathResult.STRING_TYPE, null).stringValue;
	var roundOf = attrW.length * 2;
	document.title = short + ' R' + roundOf + ' Draw Probabilities';
	var heading = document.getElementsByTagName('h1')[0];
	heading.innerHTML = short + ' Draw Probabilities <small>(' + season + ' Round of ' + roundOf + ')</small>';
	if (potSize < 9) {
		document.getElementById('cldraw-table').classList.remove('table-condensed');
		document.getElementById('cldraw-table').parentNode.classList.remove('col-xs-12');
		document.getElementById('cldraw-table').parentNode.classList.add('col-md-9');
		document.getElementById('cldraw-table').parentNode.classList.add('col-md-pull-3');
		document.getElementById('cldraw-fixtures-panel').classList.add('col-md-3');
		document.getElementById('cldraw-fixtures-panel').classList.add('col-md-push-9');
		document.getElementById('cldraw-fixtures-panel').classList.remove('col-xs-12');
		var fixtures = document.getElementsByClassName('cldraw-fixtures');
		for (var i = 0; i < fixtures.length; i++) {
			fixtures[i].classList.remove('col-md-6');
		}
		var wrapper = document.getElementsByClassName('cldraw-fixtures-wrapper');
		for (var i = 0; i < wrapper.length; i++) {
			wrapper[i].classList.add('col-md-12');
		}
	} else {
		document.getElementById('cldraw-table').classList.add('table-condensed');
		document.getElementById('cldraw-table').parentNode.classList.add('col-xs-12');
		document.getElementById('cldraw-table').parentNode.classList.remove('col-md-9');
		document.getElementById('cldraw-table').parentNode.classList.remove('col-md-pull-3');
		document.getElementById('cldraw-fixtures-panel').classList.remove('col-md-3');
		document.getElementById('cldraw-fixtures-panel').classList.remove('col-md-push-9');
		document.getElementById('cldraw-fixtures-panel').classList.add('col-xs-12');
		var fixtures = document.getElementsByClassName('cldraw-fixtures');
		for (var i = 0; i < fixtures.length; i++) {
			fixtures[i].classList.add('col-md-6');
		}
		var wrapper = document.getElementsByClassName('cldraw-fixtures-wrapper');
		for (var i = 0; i < wrapper.length; i++) {
			wrapper[i].classList.remove('col-md-12');
		}
	}
}


function reset(expensive) {
	if (!ignoreClicks || expensive) {
		for (var i = 0; i < potSize; i++) {
			drawnW[i] = false;
			drawnR[i] = false;
			matched[i] = -1;
		}
		drawHistory = [];
		document.getElementById('button-randomteam').classList.add('disabled');
		document.getElementById('cldraw-computation').style.display = 'none';
		if (expensive) {
			document.getElementById('cldraw-computation-running').style.display = '';
		}

		calculator.postMessage([GET_PROBABILITIES]);
		calculator.onmessage = function(e) {
			var probabilities = e.data;
			updateTable(probabilities);
			createButtonsR(probabilities);
			document.getElementById('cldraw-computation-running').style.display = 'none';
			document.getElementById('button-randomteam').classList.remove('disabled');
			var button = document.getElementById('button-dl');
			if (potSize > 12 && !precomputedSeasons.has(selectedSeason.toString())) {
				button.style.display = '';
			} else {
				button.style.display = 'none';
			}
			ignoreClicks = false;
		}
		updateFixtures();
	}
}


function downloadProbabilities() {
	if (!document.getElementById('cldraw-computation-download').classList.contains('disabled')) {
		document.getElementById('cldraw-computation').style.display = 'none';
		document.getElementById('cldraw-dlprogress').style.display = '';
		precomputedSeasons.add(selectedSeason.toString());
		calculator.postMessage([GET_ID]);
		calculator.onmessage = function(e) {
			var filename = 'probabilities/' + e.data[0] + '.json';
			activeDownload = new XMLHttpRequest();
			activeDownload.addEventListener('load', processDownload);
			activeDownload.addEventListener('progress', updateProgress);
			activeDownload.addEventListener('error', abortDownload);
			activeDownload.addEventListener('abort', abortDownload);
			activeDownload.open('GET', filename);
			activeDownload.send();
		}
	}
}


function processDownload() {
	var probabilities = JSON.parse(this.responseText);
	var minLength = 999999;
	for (var id in probabilities) {
		if (id.length < minLength) {
			minLength = id.length;
		}
	}
	calculator.postMessage([IMPORT_PROBABILITIES, probabilities]);
	importedLimit[selectedSeason.toString()] = minLength / 4;

	document.getElementById('cldraw-dlprogress').style.display = 'none';
	ignoreClicks = false;
	reset();
}


function abortDownload() {
	initialize(selectedSeason[0], selectedSeason[1]);
}


function updateProgress(progress) {
	if (progress.lengthComputable) {
		document.getElementById('cldraw-dlprogress-text').style.display = '';
		document.getElementById('cldraw-dlprogress-text').innerHTML = (progress.loaded / 1000000).toFixed(1) + ' MB of ' + (progress.total / 1000000).toFixed(1) + ' MB downloaded.';
		var percentComplete = progress.loaded / progress.total * 100;
		document.getElementById('cldraw-dlprogressbar').style.width = percentComplete + '%';
		document.getElementById('cldraw-dlprogressbar').setAttribute('aria-valuenow', percentComplete.toFixed());
	} else {
		document.getElementById('cldraw-dlprogressbar').style.width = '100%';
		document.getElementById('cldraw-dlprogressbar').setAttribute('aria-valuenow', 100);
		document.getElementById('cldraw-dlprogress-text').style.display = 'none';
	}
}


function getPossibleMatches(probabilities, team) {
	var possibleMatch = [];
	var indexR = team;
	for (var i = 0; i < team; i++) {
		if (drawnR[i]) {
			indexR--;
		}
	}
	var indexW = 0;
	for (var i = 0; i < potSize; i++) {
		if (drawnW[i]) {
			possibleMatch[i] = false;
			indexW++;
		} else {
			if (probabilities[i - indexW][indexR] > 0) {
				possibleMatch[i] = true;
			} else {
				possibleMatch[i] = false;
			}
		}
	}
	return possibleMatch;
}


function drawRunnerUp(team) {
	if (!ignoreClicks) {
		ignoreClicks = true;
		disableButtons();
		var remainingTeams = 0;
		for (var i = 0; i < potSize; i++) {
			if (!drawnR[i]) {
				remainingTeams++;
			}
		}
		// show alert if probabilities were imported and remaining probabilities need to be computed now
		if (remainingTeams == importedLimit[selectedSeason.toString()]) {
			document.getElementById('cldraw-computation-running2').style.display = '';
		}
		drawnR[team] = true;
		// write to history before table is updated, needed to hide drawn teams
		drawHistory.push(team);
		calculator.postMessage([GET_PROBABILITIES, drawnW, drawnR, team]);
		calculator.onmessage = function(e) {
			var probabilities = e.data;
			updateTable(probabilities, team);
			createButtonsW(team, probabilities);
			updateFixtures();
			ignoreClicks = false;
		}
	}
}


function drawWinner(team, opponent) {
	if (!ignoreClicks) {
		ignoreClicks = true;
		disableButtons();
		matched[team] = opponent;
		drawnW[team] = true;
		// write to history before table is updated, needed to hide drawn teams
		drawHistory.push(team + potSize);
		calculator.postMessage([GET_PROBABILITIES, drawnW, drawnR]);
		calculator.onmessage = function(e) {
			var probabilities = e.data;
			updateTable(probabilities);
			createButtonsR(probabilities);
			updateFixtures();
			ignoreClicks = false;
		}
	}
}


function undo() {
	if (!ignoreClicks) {
		team = drawHistory.pop();
		if (team != undefined) {
			if (team < potSize) {
				ignoreClicks = true;
				drawnR[team] = false;
				calculator.postMessage([GET_PROBABILITIES, drawnW, drawnR]);
				calculator.onmessage = function(e) {
					var probabilities = e.data;
					updateTable(probabilities);
					createButtonsR(probabilities);
					ignoreClicks = false;
				}
				updateFixtures();
			} else {
				team -= potSize;
				drawnW[team] = false;
				matched[team] = -1;
				opponent = drawHistory.pop();
				drawnR[opponent] = false;
				drawRunnerUp(opponent);
			}
			document.getElementById('button-randomteam').classList.remove('disabled');
		}
	}
}


function drawRandomTeam() {
	if (!ignoreClicks) {
		disableButtons();
		if (drawHistory.length % 2 == 0) {
			var numR = 0;
			for (var i = 0; i < potSize; i++) {
				if (!drawnR[i]) {
					numR++;
				}
			}
			if (numR > 0) {
				var team = Math.floor(Math.random() * numR);
				for (var i = 0; i <= team; i++) {
					if (drawnR[i]) {
						team++;
					}
				}
				drawRunnerUp(team);
			}
		} else {
			var opponent = drawHistory[drawHistory.length - 1];
			calculator.postMessage([GET_PROBABILITIES, drawnW, drawnR, opponent]);
			calculator.onmessage = function(e) {
				var probabilities = e.data;
				var possibleMatch = getPossibleMatches(probabilities, opponent);
				var numW = 0;
				for (var i = 0; i < potSize; i++) {
					if (possibleMatch[i]) {
						numW++;
					}
				}
				var team = Math.floor(Math.random() * numW);
				for (var i = 0; i <= team && i < 20; i++) {
					if (!possibleMatch[i]) {
						team++;
					}
				}
				drawWinner(team, opponent);
			}
		}
	}
}


function updateTable(probabilities, highlight) {
	if (probabilities == null) {
		document.getElementById('cldraw-impossible').style.display = '';
		return;
	}
	var fullProbabilities = [];
	var indexW = 0;
	for (var i = 0; i < potSize; i++) {
		fullProbabilities[i] = [];
		if (drawnW[i]) {
			var opponent = matched[i];
			for (var j = 0; j < potSize; j++) {
				if (j == opponent) {
					fullProbabilities[i][j] = 1;
				} else {
					fullProbabilities[i][j] = 0;
				}
			}
		} else {
			var indexR = 0;
			for (var j = 0; j < potSize; j++) {
				if (drawnR[j] && j != highlight) {
					fullProbabilities[i][j] = 0;
				} else {
					fullProbabilities[i][j] = probabilities[indexW][indexR];
					indexR++;
				}
			}
			indexW++;
		}
	}

	var table = document.getElementById('cldraw-table');
	for (var i = 0; i < potSize; i++){
		for (var j = 0; j < potSize; j++){
			var color = '';
			var text;
			if (matched[i] == j) {
				text = '\u2714';
				color = '#4998ff';
			} else {
				text = (100 * fullProbabilities[i][j]).toFixed(2) + '%';
				if (fullProbabilities[i][j] == 0) {
					color = '#999999';
				} else if (j == highlight) {
					color = '#f5ff75';
				}
			}
			if (!swap) {
				table.rows[i + 1].cells[j + 1].innerHTML = text;
				table.rows[i + 1].cells[j + 1].style.background = color;
			} else {
				table.rows[j + 1].cells[i + 1].innerHTML = text;
				table.rows[j + 1].cells[i + 1].style.background = color;
			}
		}
	}
	document.getElementById('cldraw-impossible').style.display = 'none';
	document.getElementById('cldraw-computation-running2').style.display = 'none';
	if (hideMode) {
		hideDrawnTeams();
	}
}


function updateFixtures() {
	var fixtures = document.getElementsByClassName('cldraw-fixtures');
	var l = Math.ceil(potSize / fixtures.length);
	for (var i = 0; i < fixtures.length; i++) {
		while (fixtures[i].firstChild) {
			fixtures[i].removeChild(fixtures[i].firstChild);
		}
		for (var j = i * l; j < l * (i + 1); j++) {
			var row = document.createElement('div');
			row.classList.add('row');
			var left = document.createElement('div');
			left.classList.add('col-xs-6');
			left.classList.add('text-right');
			left.classList.add('padding-0');
			var right = document.createElement('div');
			right.classList.add('col-xs-6');
			right.classList.add('text-left');
			right.classList.add('padding-0');
			var small = document.createElement('small');
			small.appendChild(document.createTextNode('s\u00A0\u00A0'));
			right.appendChild(small);
			if (j * 2 < drawHistory.length) {
				left.appendChild(document.createTextNode(teamsR[drawHistory[j * 2]]));
			} else {
				left.appendChild(document.createTextNode('.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.'));
			}
			if (j * 2 + 1 < drawHistory.length) {
				right.appendChild(document.createTextNode(teamsW[drawHistory[j * 2 + 1] - potSize]));
			} else {
				right.appendChild(document.createTextNode('.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.\u00A0.'));
			}
			small = document.createElement('small');
			small.appendChild(document.createTextNode('\u00A0\u00A0v'));
			left.appendChild(small);
			row.appendChild(left);
			row.appendChild(right);
			fixtures[i].appendChild(row);
		}
	}
	if (drawHistory.length > 0) {
		document.getElementById('button-undo').classList.remove('disabled');
		document.getElementById('button-restart').classList.remove('disabled');
	} else {
		document.getElementById('button-undo').classList.add('disabled');
		document.getElementById('button-restart').classList.add('disabled');
	}
}


function hideDrawnTeams() {
	var matchedR = [];
	var matchedW = [];
	var n = drawHistory.length;
	if (n % 2 == 1) {
		n -= 1;
	}
	for (var i = 0; i < n; i++) {
		var team = drawHistory[i];
		if (team < potSize) {
			matchedR[team] = true;
		} else {
			team -= potSize;
			matchedW[team] = true;
		}
	}

	var table = document.getElementById('cldraw-table');
	if (swap) {
		for (var i = 0; i < potSize; i++) {
			if (matchedR[i]) {
				table.rows[i + 1].style.display = 'none';
			} else {
				table.rows[i + 1].style.display = '';
			}
			for (j = 0; j < potSize + 1; j++) {
				if (matchedW[i]) {
					table.rows[j].cells[i + 1].style.display = 'none';
				} else {
					table.rows[j].cells[i + 1].style.display = '';
				}
			}
		}
	} else {
		for (var i = 0; i < potSize; i++) {
			if (matchedW[i]) {
				table.rows[i + 1].style.display = 'none';
			} else {
				table.rows[i + 1].style.display = '';
			}
			for (j = 0; j < potSize + 1; j++) {
				if (matchedR[i]) {
					table.rows[j].cells[i + 1].style.display = 'none';
				} else {
					table.rows[j].cells[i + 1].style.display = '';
				}
			}
		}
	}
}


// create buttons of runner-up teams which were not drawn yet
function createButtonsR(probabilities) {
	removeButtons();
	var buttonList = document.getElementById('cldraw-buttons');
	var button = [];
	var numR = 0;
	for (var i = 0; i < potSize ; i++) {
		if (!drawnR[i]) {
			numR++;
			button[i] = document.createElement('button');
			button[i].classList.add('btn');
			button[i].classList.add('btn-primary');
			var text = document.createTextNode(teamsR[i]);
			button[i].appendChild(text);
			button[i].addEventListener('click', drawRunnerUp.bind(null, i, false), false);
		}
	}

	if (previewMode) {
		var teams = [];
		for (var i = 0; i < potSize; i++) {
			if (button[i] != undefined) {
				teams[i] = true;
			}
		}
		calculator.postMessage([GET_PROBABILITIES_PREVIEW, drawnW, drawnR, teams]);
		calculator.onmessage = function(e) {
			var probabilities2 = e.data;
			for (var i = 0; i < potSize; i++) {
				if (button[i] != undefined) {
					button[i].addEventListener('mouseover', updateTable.bind(null, probabilities2[i], i), false);
					button[i].addEventListener('mouseout', updateTable.bind(null, probabilities), false);
					buttonList.appendChild(button[i]);
				}
			}
		}
	} else {
		for (var i = 0; i < potSize; i++) {
			if (button[i] != undefined) {
				buttonList.appendChild(button[i]);
			}
		}
	}

	if (numR > 0) {
		document.getElementById('button-randomteam').classList.remove('disabled');
	}
}


// create buttons of group winners which can be matched with the last drawn runner-up
function createButtonsW(opponent, probabilities) {
	removeButtons();
	var buttonList = document.getElementById('cldraw-buttons');
	var button = [];
	var possibleMatch = getPossibleMatches(probabilities, opponent);
	for (var i = 0; i < potSize ; i++) {
		if (possibleMatch[i]) {
			button[i] = document.createElement('button');
			button[i].classList.add('btn');
			button[i].classList.add('btn-primary');
			var text = document.createTextNode(teamsW[i]);
			button[i].appendChild(text);
			button[i].addEventListener('click', drawWinner.bind(null, i, opponent, false), false);
		}
	}

	if (previewMode) {
		var teams = [];
		for (var i = 0; i < potSize; i++) {
			if (button[i] != undefined) {
				teams[i] = true;
			}
		}
		calculator.postMessage([GET_PROBABILITIES_PREVIEW, drawnW, drawnR, teams]);
		calculator.onmessage = function(e) {
			var probabilities2 = e.data;
			for (var i = 0; i < potSize; i++) {
				if (button[i] != undefined) {
					button[i].addEventListener('mouseover', previewHelper.bind(null, probabilities2[i], i, opponent), false);
					button[i].addEventListener('mouseout', updateTable.bind(null, probabilities, opponent), false);
					buttonList.appendChild(button[i]);
				}
			}
		}
	} else {
		for (var i = 0; i < potSize; i++) {
			if (button[i] != undefined) {
				buttonList.appendChild(button[i]);
			}
		}
	}
	document.getElementById('button-randomteam').classList.remove('disabled');
}


function removeButtons() {
	document.getElementById('button-randomteam').classList.add('disabled');
	var buttonList = document.getElementById('cldraw-buttons');
	while (buttonList.firstChild) {
		buttonList.removeChild(buttonList.firstChild);
	}
}


function disableButtons() {
	document.getElementById('button-randomteam').classList.add('disabled');
	var buttons = document.getElementById('cldraw-buttons').children;
	for (var i = 0; i < buttons.length; i++) {
		buttons[i].classList.add('disabled');
	}
}


function previewHelper(probabilities, winner, runnerUp) {
	drawnW[winner] = true;
	matched[winner] = runnerUp;
	updateTable(probabilities);
	drawnW[winner] = false;
	matched[winner] = -1;
}


function togglePreviewMode() {
	var button = document.getElementById('button-preview');
	if (previewMode) {
		previewMode = false;
		button.classList.remove('active');
	} else {
		previewMode = true;
		button.classList.add('active');
	}
	if (drawHistory.length == 0) {
		if (!ignoreClicks) {
			reset();
		}
	} else {
		var team = drawHistory.pop();
		if (team < potSize) {
			drawRunnerUp(team);
		} else {
			drawWinner(team - potSize, drawHistory[drawHistory.length - 1]);
		}
	}
}


function toggleHideMode() {
	var button = document.getElementById('button-hide');
	if (hideMode) {
		hideMode = false;
		button.classList.remove('active');
		var table = document.getElementById('cldraw-table');
		for (var i = 0; i < potSize; i++) {
			table.rows[i + 1].style.display = '';
			for (var j = 0; j < potSize + 1; j++) {
				table.rows[j].cells[i + 1].style.display = '';
			}
		}
	} else {
		hideMode = true;
		button.classList.add('active');
		hideDrawnTeams();
	}
}


function transposeTable() {
	swap = !swap;
	var table = document.getElementById('cldraw-table');
	var oldTable = [];
	for (var i = 0; i < potSize; i++) {
		oldTable[i] = [];
		for (var j = 0; j < potSize; j++) {
			oldTable[i][j] = [];
			oldTable[i][j][0] = table.rows[i + 1].cells[j + 1].innerHTML;
			oldTable[i][j][1] = table.rows[i + 1].cells[j + 1].style.background;
		}
	}
	createTable();
	for (var i = 0; i < potSize; i++) {
		for (var j = 0; j < potSize; j++) {
			table.rows[i + 1].cells[j + 1].innerHTML = oldTable[j][i][0];
			table.rows[i + 1].cells[j + 1].style.background = oldTable[j][i][1];
		}
	}
	if (hideMode) {
		hideDrawnTeams();
	}
}


function resizeTable(enlarge) {
	window.removeEventListener('resize', autoResizeTable, false);
	var table = document.getElementById('cldraw-table');
	if (table.classList.contains('table-smallest')) {
		if (enlarge) {
			document.getElementById('button-shrink').classList.remove('disabled');
			table.classList.remove('table-smallest');
			table.classList.add('table-smaller');
		}
	} else if (table.classList.contains('table-smaller')) {
		table.classList.remove('table-smaller');
		if (enlarge) {
			table.classList.add('table-small');
		} else {
			document.getElementById('button-shrink').classList.add('disabled');
			table.classList.add('table-smallest');
		}
	} else if (table.classList.contains('table-small')) {
		table.classList.remove('table-small');
		if (enlarge) {
			table.classList.add('table-medium');
		} else {
			table.classList.add('table-smaller');
		}
	} else if (table.classList.contains('table-medium')) {
		table.classList.remove('table-medium');
		if (enlarge) {
			document.getElementById('button-enlarge').classList.add('disabled');
		} else {
			table.classList.add('table-small');
		}
	} else {
		if (!enlarge) {
			document.getElementById('button-enlarge').classList.remove('disabled');
			table.classList.add('table-medium');
		}
	}
}

// shrink table on extra small to medium devices (bootstrap classification)
function autoResizeTable() {
	if (window.innerWidth > 1199) {
		document.getElementById('button-enlarge').classList.add('disabled');
		document.getElementById('cldraw-table').classList.remove('table-medium');
	} else {
		document.getElementById('button-enlarge').classList.remove('disabled');
		document.getElementById('cldraw-table').classList.add('table-medium');
	}
}


function saveTeams() {
	var season = document.getElementById('cldraw-editor-season').value;
	var button = document.getElementById('button-editor');
	button.classList.remove('active');
	var teams = document.createElementNS('', 'teams');
	teams.setAttribute('competition', selectedSeason[0]);
	teams.setAttribute('season', season);
	var winners = document.createElementNS('', 'winners');
	var runnersUp = document.createElementNS('', 'runners-up');
	for (var i = 0; i < potSize; i++) {
		var team = document.createElementNS('', 'team');
		team.textContent = document.getElementsByClassName('cldraw-winner')[i].value;
		if (i < 12) {
			team.setAttribute('group', String.fromCharCode(65 + i));
		}
		team.setAttribute('country', document.getElementsByClassName('cldraw-winner-country')[i].value);
		winners.appendChild(team);

		team = document.createElementNS('', 'team');
		team.textContent = document.getElementsByClassName('cldraw-runner-up')[i].value;
		if (i < 12) {
			team.setAttribute('group', String.fromCharCode(65 + i));
		}
		team.setAttribute('country', document.getElementsByClassName('cldraw-runner-up-country')[i].value);
		runnersUp.appendChild(team);
	}
	teams.appendChild(winners);
	teams.appendChild(runnersUp);

	var oldTeams = config.evaluate('//teams[@competition = "' + selectedSeason[0] + '"][@season = "' + season + '"]', config, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null).singleNodeValue;
	if (oldTeams == null) {
		config.firstChild.insertBefore(teams, config.firstChild.firstChild);
	} else {
		config.firstChild.replaceChild(teams, oldTeams);
	}

	removeButtons();
	initialize(selectedSeason[0], season);
}


function exportJSON(limit, auto) {
	if (limit == undefined) {
		limit = 0;
	}
	calculator.postMessage([EXPORT_PROBABILITIES, limit]);
	calculator.onmessage = function(e) {
		var probabilities = e.data;
		var filename = '';
		var maxLength = -1;
		for (var id in probabilities) {
			if (id.length > maxLength) {
				filename = id;
				maxLength = id.length;
			}
		}
		var a = document.createElement('a');
		document.body.appendChild(a);
		var blob = new Blob([JSON.stringify(probabilities)], {type: 'octet/stream'});
		// increase limit if file is larger than 50MB (usually 5-10MB gzipped)
		if (auto && blob.size > 50000000) {
			calculator.postMessage([EXPORT_PROBABILITIES, limit + 1]);
		} else {
			url = window.URL.createObjectURL(blob);
			a.href = url;
			a.download = filename + '.json';
			a.click();
			window.URL.revokeObjectURL(url);
		}
	}
}

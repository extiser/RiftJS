(function() {

	var escapeRegExp = _.regex.escape;
	var nextTick = _.process.nextTick;

	var reNotLocal = /^(?:\w+:)?\/\//;
	var reSlashes = /[\/\\]+/g;
	var reInsert = /\{([^}]+)\}/g;
	var reOption = /\((?:\?(\S+)\s+)?([^)]+)\)/g;

	/**
	 * @private
	 *
	 * @param {string} str
	 * @returns {number|string}
	 */
	function tryStringAsNumber(str) {
		if (str != '') {
			if (str == 'NaN') {
				return NaN;
			}

			var num = Number(str);

			if (num == num) {
				return num;
			}
		}

		return str;
	}

	/**
	 * Кодирует путь. Символы те же, что и у encodeURIComponent, кроме слеша `/`.
	 * В отличии от encodeURI и encodeURIComponent не трогает уже закодированное:
	 *     encodeURIComponent(' %20'); // => '%20%2520'
	 *     encodePath(' %20'); // => '%20%20'
	 *
	 * @example
	 * encodeURIComponent(' %20/%2F'); // => '%20%2520%2F%252F'
	 * encodePath(' %20/%2F'); // => '%20%20/%2F'
	 *
	 * @private
	 *
	 * @param {string} path
	 * @returns {string}
	 */
	function encodePath(path) {
		path = path.split('/');

		for (var i = path.length; i;) {
			path[--i] = encodeURIComponent(decodeURIComponent(path[i]));
		}

		return path.join('/');
	}

	/**
	 * @private
	 *
	 * @param {string} path
	 * @returns {string}
	 */
	function slashifyPath(path) {
		if (path[0] != '/') {
			path = '/' + path;
		}
		if (path[path.length - 1] != '/') {
			path += '/';
		}

		return path;
	}

	/**
	 * @typedef {{
	 *     rePath: RegExp,
	 *     fields: { type: int, id: string },
	 *     requiredFields: Array<string>,
	 *     pathMap: { requiredFields: Array<string>, pathPart: string=, field: string= },
	 *     callback: Function
	 * }} Router~Route
	 */

	/**
	 * @class Rift.Router
	 * @extends {Object}
	 *
	 * @param {Rift.BaseApp} app
	 * @param {Array<{ path: string, callback: Function= }|string>} [routes]
	 */
	function Router(app, routes) {
		this._onViewStateChange = this._onViewStateChange.bind(this);

		this.app = app;

		this.routes = [];

		if (routes) {
			this.addRoutes(routes);
		}
	}

	Object.assign(Router.prototype, /** @lends Rift.Router# */{
		/**
		 * Ссылка на приложение.
		 *
		 * @type {Rift.App}
		 */
		app: null,

		/**
		 * Ссылка на корневой элемент въюшки.
		 *
		 * @type {?HTMLElement}
		 */
		viewBlock: null,

		/**
		 * @type {Array<Router~Route>}
		 * @protected
		 */
		routes: null,

		/**
		 * @type {?Router~Route}
		 */
		currentRoute: null,

		/**
		 * @type {string|undefined}
		 */
		currentPath: undef,

		/**
		 * @type {boolean}
		 */
		started: false,

		_isViewStateChangeHandlingRequired: false,
		_isHistoryPositionFrozen: false,

		/**
		 * @param {Array<{ path: string, callback: Function }|string>} routes
		 * @returns {Rift.Router}
		 */
		addRoutes: function(routes) {
			routes.forEach(function(route) {
				if (typeof route == 'string') {
					route = { path: route };
				}

				this.addRoute(route.path, route.callback);
			}, this);

			return this;
		},

		/**
		 * @param {string} path
		 * @param {Function|undefined} [callback]
		 * @returns {Rift.Router}
		 */
		addRoute: function(path, callback) {
			path = path.split(reOption);

			var rePath = [];
			var fields = [];
			var requiredFields = [];
			var pathMap = [];

			for (var i = 0, l = path.length; i < l;) {
				if (i % 3) {
					rePath.push('(');

					var pathMapItemRequiredFields = [];

					if (path[i]) {
						pathMapItemRequiredFields.push(path[i]);

						fields.push({
							type: 1,
							id: path[i]
						});
					}

					var pathPart = path[i + 1].split(reInsert);

					for (var j = 0, m = pathPart.length; j < m; j++) {
						if (j % 2) {
							var id = pathPart[j];

							pathMapItemRequiredFields.push(id);

							rePath.push('([^\\/]+)');

							fields.push({
								type: 2,
								id: id
							});

							pathMap.push({
								requiredFields: pathMapItemRequiredFields,
								field: id
							});
						} else {
							if (pathPart[j]) {
								var encodedPathPart = encodePath(pathPart[j]);

								rePath.push(escapeRegExp(encodedPathPart).split('\\*').join('.*?'));

								pathMap.push({
									requiredFields: pathMapItemRequiredFields,
									pathPart: encodedPathPart.split('*').join('')
								});
							}
						}
					}

					rePath.push(')?');

					i += 2;
				} else {
					if (path[i]) {
						var pathPart = path[i].split(reInsert);

						for (var j = 0, m = pathPart.length; j < m; j++) {
							if (j % 2) {
								var id = pathPart[j];

								rePath.push('([^\\/]+)');

								fields.push({
									type: 0,
									id: id
								});

								requiredFields.push(id);

								pathMap.push({
									requiredFields: [id],
									field: id
								});
							} else {
								if (pathPart[j]) {
									var encodedPathPart = encodePath(pathPart[j]);

									rePath.push(escapeRegExp(encodedPathPart).split('\\*').join('.*?'));

									pathMap.push({
										requiredFields: [],
										pathPart: encodedPathPart.split('*').join('')
									});
								}
							}
						}
					}

					i++;
				}
			}

			this.routes.push({
				rePath: RegExp('^\\/?' + rePath.join('') + '\\/?$'),
				fields: fields,
				requiredFields: requiredFields,
				pathMap: pathMap,
				callback: callback
			});

			return this;
		},

		/**
		 * @returns {Rift.Router}
		 */
		reset: function() {
			this.app.viewState.update({});

			var match = this._tryViewState();

			if (match) {
				var path = match.path;

				if (path === this.currentPath) {
					if (isClient) {
						var state = history.state || {};

						if (!state['_rt-state']) {
							state['_rt-state'] = {
								routeIndex: this.routes.indexOf(this.currentRoute),
								path: path
							};
						}

						state['_rt-state'].viewStateData = {};

						history.replaceState(state, null, path);
					}
				} else {
					var route = match.route;

					this.currentRoute = route;
					this.currentPath = path;

					if (isClient) {
						var state = history.state || {};

						state['_rt-state'] = {
							routeIndex: this.routes.indexOf(this.currentRoute),
							path: path,
							viewStateData: {}
						};

						history.replaceState(state, null, path);
					}

					if (route.callback) {
						this._isHistoryPositionFrozen = true;
						route.callback.call(this.app, path);
						this._isHistoryPositionFrozen = false;
					}
				}
			} else {
				this.currentRoute = null;
				this.currentPath = undef;

				if (isClient) {
					var state = history.state || {};

					delete state['_rt-state'];
					history.replaceState(state, null, '/');
				}
			}

			return this;
		},

		/**
		 * @returns {Rift.Router}
		 */
		start: function() {
			if (this.started) {
				return this;
			}

			this.started = true;

			if (isClient) {
				this.viewBlock = this.app.view.block[0];
			}

			this.viewState = this.app.viewState;

			this._bindEvents();

			return this;
		},

		/**
		 * @protected
		 */
		_bindEvents: function() {
			if (isClient) {
				window.addEventListener('popstate', this._onWindowPopState.bind(this), false);
				this.viewBlock.addEventListener('click', this._onViewBlockClick.bind(this), false);
			}

			var viewState = this.app.viewState;
			var onViewStateFieldChange = this._onViewStateFieldChange;
			var fields = viewState.fields;

			for (var i = fields.length; i;) {
				viewState[fields[--i]]('subscribe', onViewStateFieldChange, this);
			}
		},

		/**
		 * @protected
		 */
		_onWindowPopState: function() {
			var state = history.state && history.state['_rt-state'];

			if (!state) {
				this.currentRoute = null;
				this.currentPath = undef;
				this.app.viewState.update({});

				return;
			}

			var route = this.routes[state.routeIndex];

			this.currentRoute = route;
			this.currentPath = state.path;
			this.app.viewState.updateFromSerializedData(state.viewStateData);

			if (route.callback) {
				this._isHistoryPositionFrozen = true;
				route.callback.call(this.app, state.path);
				this._isHistoryPositionFrozen = false;
			}
		},

		/**
		 * Обработчик клика по корневому элементу въюшки.
		 *
		 * @protected
		 *
		 * @param {MouseEvent} evt
		 */
		_onViewBlockClick: function(evt) {
			var viewBlock = this.viewBlock;
			var el = evt.target;

			while (el.tagName != 'A') {
				if (el == viewBlock) {
					return;
				}

				el = el.parentNode;
			}

			var href = el.getAttribute('href');

			if (!reNotLocal.test(href) && this.route(href)) {
				evt.preventDefault();
			}
		},

		/**
		 * @protected
		 */
		_onViewStateFieldChange: function() {
			if (this._isViewStateChangeHandlingRequired) {
				return;
			}

			this._isViewStateChangeHandlingRequired = true;

			nextTick(this._onViewStateChange);
		},

		/**
		 * Обработчик изменения состояния представления.
		 *
		 * @protected
		 */
		_onViewStateChange: function() {
			if (!this._isViewStateChangeHandlingRequired) {
				return;
			}

			this._isViewStateChangeHandlingRequired = false;

			var match = this._tryViewState(this.currentRoute);

			if (!match) {
				return;
			}

			var path = match.path;

			if (path === this.currentPath) {
				if (isClient) {
					var state = history.state || {};

					if (!state['_rt-state']) {
						state['_rt-state'] = {
							routeIndex: this.routes.indexOf(this.currentRoute),
							path: path
						};
					}

					state['_rt-state'].viewStateData = this.app.viewState.serializeData();

					history.replaceState(state, null, path);
				}
			} else {
				var route = match.route;

				this.currentRoute = route;
				this.currentPath = path;

				if (isClient) {
					history.pushState({
						'_rt-state': {
							routeIndex: this.routes.indexOf(route),
							path: path,
							viewStateData: this.app.viewState.serializeData()
						}
					}, null, path);
				}

				if (route.callback) {
					this._isHistoryPositionFrozen = true;
					route.callback.call(this.app, path);
					this._isHistoryPositionFrozen = false;
				}
			}
		},

		/**
		 * Редиректит по указанному пути.
		 * Если нет подходящего маршрута - возвращает false, редиректа не происходит.
		 *
		 * @param {string} path
		 * @returns {boolean}
		 */
		route: function(path) {
			path = encodePath(path.replace(reSlashes, '/'));

			if (path[0] != '/') {
				var locationPath = location.pathname;
				path = locationPath + (locationPath[locationPath.length - 1] == '/' ? '' : '/') + path;
			}

			if (path[path.length - 1] != '/') {
				path += '/';
			}

			if (path === this.currentPath) {
				return true;
			}

			var match = this._tryPath(path);

			if (!match) {
				return false;
			}

			var route = match.route;

			this.currentRoute = route;
			this.currentPath = path;
			this.app.viewState.update(match.state);

			if (isClient) {
				history[this._isHistoryPositionFrozen ? 'replaceState' : 'pushState']({
					'_rt-state': {
						routeIndex: this.routes.indexOf(route),
						path: path,
						viewStateData: this.app.viewState.serializeData()
					}
				}, null, path);
			}

			if (route.callback) {
				this._isHistoryPositionFrozen = true;
				route.callback.call(this.app, path);
				this._isHistoryPositionFrozen = false;
			}

			return true;
		},

		/**
		 * @protected
		 *
		 * @param {string} path
		 * @returns {?{ route: Router~Route, state: Object }}
		 */
		_tryPath: function(path) {
			var routes = this.routes;

			for (var i = 0, l = routes.length; i < l; i++) {
				var route = routes[i];
				var match = path.match(route.rePath);

				if (match) {
					return {
						route: route,

						state: route.fields.reduce(function(state, field, index) {
							state[field.id] = field.type == 1 ?
								match[index + 1] !== undef :
								tryStringAsNumber(decodeURIComponent(match[index + 1]));

							return state;
						}, {})
					};
				}
			}

			return null;
		},

		/**
		 * @protected
		 *
		 * @param {Router~Route} [preferredRoute]
		 * @returns {?{ route: Router~Route, path: string }}
		 */
		_tryViewState: function(preferredRoute) {
			var viewState = this.app.viewState;
			var routes = this.routes;
			var resultRoute = null;

			for (var i = 0, l = routes.length; i < l; i++) {
				var route = routes[i];
				var requiredFields = route.requiredFields;
				var j = requiredFields.length;

				while (j--) {
					var value = viewState[requiredFields[j]]();

					if (value == null || value === false || value === '') {
						break;
					}
				}

				if (j == -1) {
					if (requiredFields.length) {
						resultRoute = route;
						break;
					} else if (!resultRoute || route === preferredRoute) {
						resultRoute = route;
					}
				}
			}

			return resultRoute && {
				route: resultRoute,
				path: this._buildPath(resultRoute)
			};
		},

		/**
		 * @protected
		 *
		 * @param {Route} route
		 * @returns {string}
		 */
		_buildPath: function(route) {
			var viewState = this.app.viewState;
			var pathMap = route.pathMap;
			var path = [];

			for (var i = 0, l = pathMap.length; i < l; i++) {
				var pathMapItem = pathMap[i];
				var requiredFields = pathMapItem.requiredFields;
				var j = requiredFields.length;

				while (j--) {
					var value = viewState[requiredFields[j]]();

					if (value == null || value === false || value === '') {
						break;
					}
				}

				if (j == -1) {
					path.push(
						hasOwn.call(pathMapItem, 'pathPart') ? pathMapItem.pathPart : viewState[pathMapItem.field]()
					);
				}
			}

			return slashifyPath(path.join(''));
		}
	});

	_.Router = Router;

})();
define([
  'core/js/adapt',
  'core/js/views/componentView',
  './modeEnum'
], function(Adapt, ComponentView, MODE) {

  class NarrativeView extends ComponentView {

    events() {
      return {
        'click .js-narrative-strapline-open-popup': 'openPopup',
        'click .js-narrative-controls-click': 'onNavigationClicked',
        'click .js-narrative-progress-click': 'onProgressClicked'
      };
    }

    initialize(...args) {
      super.initialize(...args);

      this._isInitial = true;
    }

    preRender() {
      this.listenTo(Adapt, {
        'device:changed device:resize': this.reRender,
        'notify:closed': this.closeNotify
      });
      this.renderMode();

      this.listenTo(this.model.getChildren(), {
        'change:_isActive': this.onItemsActiveChange,
        'change:_isVisited': this.onItemsVisitedChange
      });

      this.checkIfResetOnRevisit();
      this.calculateWidths();
    }

    onItemsActiveChange(item, _isActive) {
      if (_isActive === true) {
        this.setStage(item);
      }
    }

    onItemsVisitedChange(item, isVisited) {
      if (!isVisited) return;
      this.$(`[data-index="${item.get('_index')}"]`).addClass('is-visited');
    }

    calculateMode() {
      var mode = Adapt.device.screenSize === 'large' ? MODE.LARGE : MODE.SMALL;
      this.model.set('_mode', mode);
    }

    renderMode() {
      this.calculateMode();

      const isLargeMode = this.isLargeMode();
      this.$el.toggleClass('mode-large', isLargeMode).toggleClass('mode-small', !isLargeMode);
    }

    isLargeMode() {
      return this.model.get('_mode') === MODE.LARGE;
    }

    postRender() {
      this.renderMode();
      this.setupNarrative();

      this.$('.narrative__slider').imageready(this.setReadyStatus.bind(this));

      if (Adapt.config.get('_disableAnimation')) {
        this.$el.addClass('disable-animation');
      }
    }

    checkIfResetOnRevisit() {
      const isResetOnRevisit = this.model.get('_isResetOnRevisit');
      // If reset is enabled set defaults
      if (isResetOnRevisit) {
        this.model.reset(isResetOnRevisit);
      }
    }

    setupNarrative() {
      this.renderMode();
      const items = this.model.getChildren();
      if (!items || !items.length) return;

      let activeItem = this.model.getActiveItem();
      if (!activeItem) {
        activeItem = this.model.getItem(0);
        activeItem.toggleActive(true);
      } else {
        // manually trigger change as it is not fired on reentry
        items.trigger('change:_isActive', activeItem, true);
      }

      this.calculateWidths();

      if (!this.isLargeMode() && !this.model.get('_wasHotgraphic')) {
        this.replaceInstructions();
      }
      this.setupEventListeners();
      this._isInitial = false;
    }

    calculateWidths() {
      const itemCount = this.model.getChildren().length;
      this.model.set({
        _totalWidth: 100 * itemCount,
        _itemWidth: 100 / itemCount
      });
    }

    resizeControl() {
      const previousMode = this.model.get('_mode');
      this.renderMode();
      if (previousMode !== this.model.get('_mode')) this.replaceInstructions();
      this.evaluateNavigation();
      const activeItem = this.model.getActiveItem();
      if (activeItem) this.setStage(activeItem);
    }

    reRender() {
      if (this.model.get('_wasHotgraphic') && this.isLargeMode()) {
        this.replaceWithHotgraphic();
        return;
      }
      this.resizeControl();
    }

    closeNotify() {
      this.evaluateCompletion();
    }

    replaceInstructions() {
      if (this.isLargeMode()) {
        this.$('.narrative__instruction-inner').html(this.model.get('instruction'));
        return;
      }

      if (this.model.get('mobileInstruction') && !this.model.get('_wasHotgraphic')) {
        this.$('.narrative__instruction-inner').html(this.model.get('mobileInstruction'));
      }
    }

    replaceWithHotgraphic() {
      if (!Adapt.componentStore.hotgraphic) throw "Hotgraphic not included in build";
      const HotgraphicView = Adapt.componentStore.hotgraphic.view;

      const model = this.prepareHotgraphicModel();
      const newHotgraphic = new HotgraphicView({ model });

      this.$el.parents('.component__container').append(newHotgraphic.$el);
      this.remove();
      _.defer(() => {
        Adapt.trigger('device:resize');
      });
    }

    prepareHotgraphicModel() {
      const model = this.model;
      model.resetActiveItems();
      model.set({
        _isPopupOpen: false,
        _component: 'hotgraphic',
        body: model.get('originalBody'),
        instruction: model.get('originalInstruction')
      });

      return model;
    }

    moveSliderToIndex(itemIndex) {
      let offset = this.model.get('_itemWidth') * itemIndex;
      if (Adapt.config.get('_defaultDirection') === 'ltr') {
        offset *= -1;
      }
      const cssValue = `translateX(${offset}%)`;
      const $sliderElm = this.$('.narrative__slider');
      const $straplineHeaderElm = this.$('.narrative__strapline-header-inner');

      $sliderElm.css('transform', cssValue);
      $straplineHeaderElm.css('transform', cssValue);

      if (Adapt.config.get('_disableAnimation') || this._isInitial) {
        this.onTransitionEnd();
        return;
      }

      $sliderElm.one('transitionend', this.onTransitionEnd.bind(this));
    }

    onTransitionEnd() {
      if (this._isInitial) return;

      const index = this.model.getActiveItem().get('_index');
      const $elementToFocus = this.isLargeMode() ? this.$(`.narrative__content-item[data-index="${index}"]`) : this.$('.narrative__strapline-btn');

      Adapt.a11y.focusFirst($elementToFocus, { defer: true });
    }

    setStage(item) {
      const index = item.get('_index');
      const indexSelector = `[data-index="${index}"]`;

      if (this.isLargeMode()) {
        // Set the visited attribute for large screen devices
        item.toggleVisited(true);
      }

      this.$('.narrative__progress').removeClass('is-selected').filter(indexSelector).addClass('is-selected');

      const $slideGraphics = this.$('.narrative__slider-image-container');
      Adapt.a11y.toggleAccessibleEnabled($slideGraphics.children('.controls'), false);
      Adapt.a11y.toggleAccessibleEnabled($slideGraphics.filter(indexSelector).children('.controls'), true);

      const $narrativeItems = this.$('.narrative__content-item');
      $narrativeItems.addClass('u-visibility-hidden u-display-none');
      Adapt.a11y.toggleAccessible($narrativeItems, false);
      Adapt.a11y.toggleAccessible($narrativeItems.filter(indexSelector).removeClass('u-visibility-hidden u-display-none'), true);

      const $narrativeStraplineButtons = this.$('.narrative__strapline-btn');
      Adapt.a11y.toggleAccessibleEnabled($narrativeStraplineButtons, false);
      Adapt.a11y.toggleAccessibleEnabled($narrativeStraplineButtons.filter(indexSelector), true);

      this.evaluateNavigation();
      this.evaluateCompletion();
      this.moveSliderToIndex(index);
    }

    evaluateNavigation() {
      const active = this.model.getActiveItem();
      if (!active) return;

      const index = active.get('_index');
      const itemCount = this.model.getChildren().length;

      const isAtStart = index === 0;
      const isAtEnd = index === itemCount - 1;

      this.$('.narrative__controls-left').toggleClass('u-visibility-hidden', isAtStart);
      this.$('.narrative__controls-right').toggleClass('u-visibility-hidden', isAtEnd);
    }

    evaluateCompletion() {
      if (this.model.areAllItemsCompleted()) {
        this.trigger('allItems');
      }
    }

    openPopup() {
      const currentItem = this.model.getActiveItem();
      Adapt.notify.popup({
        title: currentItem.get('title'),
        body: currentItem.get('body')
      });

      Adapt.on('popup:opened', function() {
        // Set the visited attribute for small and medium screen devices
        currentItem.toggleVisited(true);
      });
    }

    onNavigationClicked(event) {
      const $btn = $(event.currentTarget);
      let index = this.model.getActiveItem().get('_index');
      $btn.data('direction') === 'right' ? index++ : index--;
      this.model.setActiveItem(index);
    }

    onProgressClicked(event) {
      const index = $(event.target).data('index');
      this.model.setActiveItem(index);
    }

    setupEventListeners() {
      if (this.model.get('_setCompletionOn') === 'inview') {
        this.setupInviewCompletion('.component__widget');
      }
    }

  }

  return NarrativeView;

});

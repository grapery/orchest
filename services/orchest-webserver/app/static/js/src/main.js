import { MDCTopAppBar } from "@material/top-app-bar";
import { MDCDrawer } from "@material/drawer";

import $ from "jquery";
window.$ = $;

import "./utils/overflowing";
import Dialogs from "./components/Dialogs";
import HeaderButtons from "./components/HeaderButtons";
import Jupyter from "./jupyter/Jupyter";
import PipelineSettingsView from "./views/PipelineSettingsView";
import PipelineView from "./views/PipelineView";
import React from "react";
import ReactDOM from "react-dom";

import { PersistentLocalConfig, makeRequest } from "./lib/utils/all";
import {
  nameToComponent,
  componentName,
  generateRoute,
  decodeRoute,
  viewNameToURIPathComponent,
} from "./utils/webserver-utils";
import ProjectsView from "./views/ProjectsView";

function Orchest() {
  // load server side config populated by flask template
  this.config = {};
  this.config = JSON.parse(window.ORCHEST_CONFIG);

  this.environment = "production";
  if (this.config["FLASK_ENV"] == "development") {
    this.environment = "development";
  }

  console.log("Orchest is running in environment: " + this.environment);

  this.reactRoot = document.querySelector(".react-view-root");

  this.browserConfig = new PersistentLocalConfig("orchest");

  const drawer = MDCDrawer.attachTo(document.getElementById("main-drawer"));

  function setDrawerSelectedIndex(drawer, viewName) {
    for (let x = 0; x < drawer.list.listElements.length; x++) {
      let listElement = drawer.list.listElements[x];
      let elementViewName = listElement.attributes.getNamedItem(
        "data-react-view"
      ).value;

      if (viewName === elementViewName) {
        drawer.list.selectedIndex = x;
      }
    }
  }
  // mount titlebar component
  this.headerBar = document.querySelector(".header-bar-interactive");
  this.headerBarComponent = ReactDOM.render(<HeaderButtons />, this.headerBar);

  drawer.list.singleSelection = true;

  this.drawer = drawer;

  drawer.listen("MDCList:action", (e) => {
    let selectedIndex = e.detail.index;

    let listElement = drawer.list.listElements[selectedIndex];

    if (listElement.attributes.getNamedItem("data-react-view")) {
      let viewName = listElement.attributes.getNamedItem("data-react-view")
        .value;

      this.loadView(nameToComponent(viewName), undefined, () => {
        setDrawerSelectedIndex(drawer, this.activeView);
      });
    }
  });

  this.sendEvent = function (event, properties) {
    if (!orchest.config["TELEMETRY_DISABLED"]) {
      makeRequest("POST", "/analytics", {
        type: "json",
        content: {
          event: event,
          properties: properties,
        },
      });
    }
  };

  this.activeView = undefined;
  this._loadView = function (TagName, dynamicProps) {
    let viewName = componentName(TagName);
    this.activeView = viewName;

    // Analytics call
    this.sendEvent("view load", { name: viewName });

    // make sure reactRoot is not hidden
    $(this.reactRoot).removeClass("hidden");

    if (this.jupyter) {
      this.jupyter.hide();
      if (TagName !== PipelineView && TagName !== PipelineSettingsView) {
        this.headerBarComponent.clearPipeline();
      }
    }

    // select menu if menu tag is selected
    for (let listIndex in drawer.list.listElements) {
      let listElement = drawer.list.listElements[listIndex];

      if (listElement.getAttribute("data-react-view") === viewName) {
        drawer.list.selectedIndex = parseInt(listIndex);
      }
    }

    ReactDOM.render(<TagName {...dynamicProps} />, this.reactRoot);
  };

  this.unsavedChanges = false;
  this.loadView = function (TagName, dynamicProps, onCancelled) {
    let conditionalBody = () => {
      // This public loadView sets the state through the
      // history API.

      let [pathname, search] = generateRoute(TagName, dynamicProps);

      // Because pushState objects need to be serialized,
      // we need to store the string representation of the TagName.
      window.history.pushState(
        {
          viewName: componentName(TagName),
          dynamicProps,
        },
        /* `title` argument for pushState was deprecated, 
        document.title should be used instead. */
        "",
        pathname + search
      );

      this._loadView(TagName, dynamicProps);
    };

    if (!this.unsavedChanges) {
      conditionalBody();
    } else {
      this.confirm(
        "Warning",
        "There are unsaved changes. Are you sure you want to navigate away?",
        () => {
          this.unsavedChanges = false;
          conditionalBody();
        },
        onCancelled
      );
    }
  };

  window.onpopstate = (event) => {
    this._loadView(
      nameToComponent(event.state.viewName),
      event.state.dynamicProps
    );
  };

  this.initializeFirstView = function () {
    // handle default
    if (location.pathname == "/") {
      this.loadDefaultView();
    }
    try {
      let [TagName, dynamicProps] = decodeRoute(
        location.pathname,
        location.search
      );
      this._loadView(TagName, dynamicProps);
    } catch (error) {
      this.loadDefaultView();
    }
  };

  this.loadDefaultView = function () {
    // if request view doesn't load, load default route
    this.loadView(ProjectsView);
  };

  setTimeout(() => {
    this.initializeFirstView();
  }, 0);

  const topAppBar = MDCTopAppBar.attachTo(document.getElementById("app-bar"));
  topAppBar.setScrollTarget(document.getElementById("main-content"));
  topAppBar.listen("MDCTopAppBar:nav", () => {
    window.localStorage.setItem("topAppBar.open", "" + !drawer.open);

    drawer.open = !drawer.open;
  });

  // persist nav menu to localStorage
  if (window.localStorage.getItem("topAppBar.open") !== null) {
    if (window.localStorage.getItem("topAppBar.open") === "true") {
      drawer.open = true;
    } else {
      drawer.open = false;
    }
  } else {
    // default drawer state is open
    drawer.open = true;
  }

  // to embed an <iframe> in the main application as a first class citizen (with state) there needs to be a
  // persistent element on the page. It will only be created when the JupyterLab UI is first requested.

  this.jupyter = new Jupyter($(".persistent-view.jupyter"));

  this.showJupyter = function () {
    this.jupyter.show();

    // hide reactDOM
    $(this.reactRoot).addClass("hidden");
  };

  this.dialogHolder = document.querySelector(".dialogs");

  // avoid anchor link clicking default behavior
  $("a[href='#']").on("click", (e) => {
    e.preventDefault();
  });

  let dialogs = ReactDOM.render(<Dialogs />, this.dialogHolder);

  this.alert = function (title, content, onClose) {
    // Analytics call
    this.sendEvent("alert show", { title: title, content: content });

    dialogs.alert(title, content, onClose);
  };
  this.confirm = function (title, content, onConfirm, onCancel) {
    // Analytics call
    this.sendEvent("confirm show", { title: title, content: content });

    dialogs.confirm(title, content, onConfirm, onCancel);
  };
}

window.orchest = new Orchest();
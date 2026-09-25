import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version, DisplayMode } from '@microsoft/sp-core-library';
import {
  IPropertyPaneConfiguration,
  PropertyPaneButton,
  PropertyPaneButtonType,
  PropertyPaneLabel,
  PropertyPaneTextField,
  PropertyPaneFieldType,
  IPropertyPaneField,
  IPropertyPaneCustomFieldProps
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { IReadonlyTheme } from '@microsoft/sp-component-base';
import * as strings from 'OntologyEditorWebPartStrings';

import OntologyEditor from './components/OntologyEditor';
import { IOntologyEditorProps } from './components/IOntologyEditorProps';

export interface IOntologyEditorWebPartProps {
  /** Server-relative URL of a .sqlite to open on load. Blank = show the picker. */
  databaseUrl: string;
  /** Server-relative library folder for browsing sources and saving back. */
  libraryFolder: string;
  /**
   * Where Publish sends the reader's copy. Blank falls back to the library
   * folder, which is the historical behaviour and puts the published file
   * beside the master — fine for a single-site trial, wrong once the editing
   * site is restricted and the viewer site is not. Accepts a server-relative
   * path on this site, or a full https URL to a folder on ANOTHER site.
   */
  publishFolder: string;
}

export default class OntologyEditorWebPart extends BaseClientSideWebPart<IOntologyEditorWebPartProps> {
  private _isDarkTheme: boolean = false;
  /**
   * Bumped to ask the editor to open its settings panel. A counter rather than
   * a boolean so a second click re-opens it, and deliberately NOT a persisted
   * property — whether a panel is open is not page content.
   */
  private _openSettingsToken: number = 0;

  /**
   * The property pane's own "a field changed" callback, captured from a custom
   * field's onRender.
   *
   * This is the ONLY way a change made outside the pane reaches the page on a
   * single-part App Page. On the modern canvas, writing `this.properties`
   * directly is enough: a host timer serialises every web part once a second,
   * diffs it and marks the page dirty. The App Page host does not do that, so
   * Save writes nothing and the page version does not even move — measured both
   * ways on 1.21.1, and a known unfixed limitation since 2019 (sp-dev-docs
   * #4410, #4456, #4550). A pane-originated change IS persisted there, hence
   * this route.
   *
   * Undefined whenever the pane is closed, because the field is then unmounted.
   */
  private _commitViaPane:
    | ((targetProperty?: string, newValue?: unknown, isValidEntry?: boolean) => void)
    | undefined = undefined;

  /**
   * Make sure the commit channel exists before the author changes anything.
   *
   * A class property rather than a method so its identity is stable: the
   * component effect that calls this is keyed on the panel's open state, and a
   * fresh closure each render would defeat that.
   */
  private readonly _ensurePaneOpen = (): void => {
    if (!this.context.propertyPane.isPropertyPaneOpen()) {
      this.context.propertyPane.open();
    }
  };

  public render(): void {
    const element: React.ReactElement<IOntologyEditorProps> = React.createElement(
      OntologyEditor,
      {
        databaseUrl: this.properties.databaseUrl,
        libraryFolder: this.properties.libraryFolder,
        publishFolder: this.properties.publishFolder,
        onPropertyChange: this._onSettingChange.bind(this),
        onSettingsOpened: this._ensurePaneOpen,
        openSettingsToken: this._openSettingsToken,
        isEditMode: this.displayMode === DisplayMode.Edit,
        isDarkTheme: this._isDarkTheme,
        context: this.context
      }
    );
    ReactDom.render(element, this.domElement);
  }

  protected onThemeChanged(currentTheme: IReadonlyTheme | undefined): void {
    if (!currentTheme) return;
    this._isDarkTheme = !!currentTheme.isInverted;
    const { semanticColors } = currentTheme;
    if (semanticColors) {
      this.domElement.style.setProperty('--bodyText', semanticColors.bodyText || null);
      this.domElement.style.setProperty('--link', semanticColors.link || null);
      this.domElement.style.setProperty('--linkHovered', semanticColors.linkHovered || null);
    }
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  /**
   * Write a value from the custom settings panel back to the web part's
   * properties, then re-render so the change is live immediately.
   *
   * Same mechanism the Ontology Browser's admin panel uses. The built-in
   * property pane keeps working unchanged — the panel is an additional way in,
   * not a replacement, which is what the pattern note requires.
   */
  private _onSettingChange(property: string, value: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.properties as any)[property] = value;
    // Write it ourselves first so the editor re-renders against the new value
    // immediately, then tell the pane, which is what actually gets it saved.
    // Harmless on the canvas, where the direct write alone would have done.
    if (this._commitViaPane) {
      try {
        this._commitViaPane(property, value, true);
      } catch (e) {
        // A commit failure must not escape into the UI. It used to: the caller
        // closes its dialog on the line AFTER this one, so a throw here left the
        // folder browser open with its button apparently dead.
        console.error('[OntologyEditor] could not persist setting', property, e);
      }
    }
    this.render();
  }

  /**
   * An invisible property pane field whose only job is to hand us the pane's
   * change callback.
   *
   * Built as a plain object rather than with the `PropertyPaneCustomField`
   * factory: that factory is exported at runtime but omitted from the package's
   * public typings (`types` points at index-internal.d.ts; the factory lives in
   * index-internal-beta.d.ts), so importing it does not compile. The field
   * SHAPE is fully public, so this needs no cast and no beta import.
   */
  private _commitChannelField(): IPropertyPaneField<IPropertyPaneCustomFieldProps> {
    return {
      type: PropertyPaneFieldType.Custom,
      targetProperty: 'settingsCommitChannel',
      shouldFocus: false,
      properties: {
        key: 'settingsCommitChannel',
        onRender: (_domElement, _ctx, changeCallback): void => {
          this._commitViaPane = changeCallback;
        },
        onDispose: (): void => {
          // The pane closed, so the callback is dead. Clearing it stops us
          // calling a stale closure and believing a change was saved.
          this._commitViaPane = undefined;
        }
      }
    };
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: strings.PropertyPaneDescription },
          groups: [
            {
              groupName: strings.DataGroupName,
              groupFields: [
                // The fields moved into the editor's own settings panel, which can
                // browse for folders and files instead of requiring a typed path.
                // This button stays because the pattern note is explicit that the
                // property pane must keep a working way in: it is the supported
                // fallback if the in-page entry points ever fail.
                // Renders nothing. It exists only to hand us the pane's change
                // callback; see _commitViaPane. Kept first so it mounts before
                // anything an author can touch.
                this._commitChannelField(),
                PropertyPaneLabel('settingsHint', {
                  text: 'Folders and files can be browsed, rather than typed, from the ' +
                        'Settings button in the editor — beside Walkthrough on the opening ' +
                        'screen, and in the command bar once an ontology is open. The fields ' +
                        'below are the typed fallback.'
                }),
                // TYPED FALLBACK — and, on a single-part App Page, currently the only
                // path that stands any chance of persisting at all. A change made in the
                // editor's own panel writes this.properties directly, which the modern
                // CANVAS picks up via its own dirty-bit polling but the App Page host
                // does not: Save there writes nothing and the page version does not even
                // move. These fields exist to establish whether a pane-originated change
                // fares any better on that host. See
                // notes/sharepoint-custom-config-panel-pattern.md.
                PropertyPaneTextField('libraryFolder', {
                  label: 'Library folder',
                  description: 'Server-relative path. Blank uses Shared Documents/Ontology.'
                }),
                PropertyPaneTextField('publishFolder', {
                  label: 'Publish folder',
                  description: 'Where Publish writes the reader\u2019s copy. May be on another site.'
                }),
                PropertyPaneTextField('databaseUrl', {
                  label: 'Database URL',
                  description: 'A .sqlite to open on load. Blank shows the picker.'
                }),
                PropertyPaneButton('openSettings', {
                  text: 'Open settings',
                  buttonType: PropertyPaneButtonType.Primary,
                  // Whatever this returns becomes the new value of the button's
                  // target property, so it MUST return the incoming value and
                  // never `this.properties` — that assigns the bag to a key
                  // inside itself, and the self-reference makes the whole web
                  // part unserializable:
                  //
                  //   TypeError: Converting circular structure to JSON
                  //     --- property 'openSettings' closes the circle
                  //
                  // _internalSerialize starts with JSON.stringify(this.properties)
                  // and runs BEFORE setDirty, so one click permanently kills
                  // saving for the session and the 1s dirty-bit timer then throws
                  // on every tick. Latent until 0.6.12.14: nothing serialised on
                  // an App Page, so the circle was never walked.
                  onClick: (value: unknown) => {
                    this._openSettingsToken += 1;
                    this.render();
                    return value;
                  }
                })
              ]
            }
          ]
        }
      ]
    };
  }
}

import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version, DisplayMode } from '@microsoft/sp-core-library';
import {
  IPropertyPaneConfiguration,
  PropertyPaneButton,
  PropertyPaneButtonType,
  PropertyPaneLabel
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

  public render(): void {
    const element: React.ReactElement<IOntologyEditorProps> = React.createElement(
      OntologyEditor,
      {
        databaseUrl: this.properties.databaseUrl,
        libraryFolder: this.properties.libraryFolder,
        publishFolder: this.properties.publishFolder,
        onPropertyChange: this._onSettingChange.bind(this),
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
    this.render();
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
                PropertyPaneLabel('settingsHint', {
                  text: 'Settings have moved into the editor itself, where folders ' +
                        'and files can be browsed rather than typed. Use the Settings ' +
                        'button in the editor — beside Walkthrough on the opening ' +
                        'screen, and in the command bar once an ontology is open.'
                }),
                PropertyPaneButton('openSettings', {
                  text: 'Open settings',
                  buttonType: PropertyPaneButtonType.Primary,
                  onClick: () => {
                    this._openSettingsToken += 1;
                    this.render();
                    return this.properties;
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

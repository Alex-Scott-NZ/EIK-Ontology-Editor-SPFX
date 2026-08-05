import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import {
  IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { IReadonlyTheme } from '@microsoft/sp-component-base';
import * as strings from 'OntologyEditorWebPartStrings';

import OntologyEditor from './components/OntologyEditor';
import { IOntologyEditorProps } from './components/IOntologyEditorProps';

export interface IOntologyEditorWebPartProps {
  /** Server-relative URL of the .sqlite file in a document library. */
  databaseUrl: string;
}

export default class OntologyEditorWebPart extends BaseClientSideWebPart<IOntologyEditorWebPartProps> {
  private _isDarkTheme: boolean = false;

  public render(): void {
    const element: React.ReactElement<IOntologyEditorProps> = React.createElement(
      OntologyEditor,
      {
        databaseUrl: this.properties.databaseUrl,
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

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: strings.PropertyPaneDescription },
          groups: [
            {
              groupName: strings.DataGroupName,
              groupFields: [
                PropertyPaneTextField('databaseUrl', {
                  label: strings.DatabaseUrlFieldLabel,
                  description: strings.DatabaseUrlFieldDescription
                })
              ]
            }
          ]
        }
      ]
    };
  }
}

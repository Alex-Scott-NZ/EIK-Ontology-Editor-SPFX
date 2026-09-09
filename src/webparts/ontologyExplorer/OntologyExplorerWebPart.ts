import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import {
  IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';

import OntologyExplorer from './components/OntologyExplorer';
import { IOntologyExplorerProps } from './components/IOntologyExplorerProps';

export interface IOntologyExplorerWebPartProps {
  /** Server-relative library folder to list .sqlite files from. */
  libraryFolder: string;
}

/**
 * A read-only inspector for the ontology databases held in SharePoint.
 *
 * Deliberately has NO access to the file system: files are listed and fetched
 * through spHttpClient as the signed-in user, so it can only ever open what
 * that person may already read. The database is parsed in the browser tab and
 * never written back — sql.js works on an in-memory copy — which is why the
 * query box is safe to expose at all.
 */
export default class OntologyExplorerWebPart extends BaseClientSideWebPart<IOntologyExplorerWebPartProps> {
  public render(): void {
    const element: React.ReactElement<IOntologyExplorerProps> = React.createElement(
      OntologyExplorer,
      {
        libraryFolder: this.properties.libraryFolder,
        context: this.context
      }
    );
    ReactDom.render(element, this.domElement);
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
          header: { description: 'Where to look for ontology databases.' },
          groups: [
            {
              groupName: 'Source',
              groupFields: [
                PropertyPaneTextField('libraryFolder', {
                  label: 'Library folder (server-relative)',
                  description: 'Blank uses this site’s Shared Documents/Ontology.'
                })
              ]
            }
          ]
        }
      ]
    };
  }
}

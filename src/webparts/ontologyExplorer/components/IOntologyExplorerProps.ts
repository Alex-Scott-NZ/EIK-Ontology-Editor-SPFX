import { WebPartContext } from '@microsoft/sp-webpart-base';

export interface IOntologyExplorerProps {
  /** Server-relative library folder to list .sqlite files from. Blank = site default. */
  libraryFolder: string;
  context: WebPartContext;
}

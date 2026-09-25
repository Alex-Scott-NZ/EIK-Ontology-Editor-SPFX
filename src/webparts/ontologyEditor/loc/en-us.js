define([], function () {
  return {
    PropertyPaneDescription: 'Where the editor looks for ontology files.',
    DataGroupName: 'Data source',
    PublishFolderFieldLabel: 'Publish folder',
    PublishFolderFieldDescription:
      'Where Publish writes the copy the Ontology Viewer reads. Leave blank to ' +
      'use the library folder above, which puts the published file beside the ' +
      'master. Give it its own folder once authors and readers need different ' +
      'permissions. A full https URL may point at a folder on another site.',
    LibraryFolderFieldLabel: 'Library folder (server-relative)',
    LibraryFolderFieldDescription:
      'Folder browsed by the source picker and used by "Save to library", e.g. /sites/knowledge/Shared Documents/ontology',
    DatabaseUrlFieldLabel: 'Database to open on load (optional)',
    DatabaseUrlFieldDescription:
      'Server-relative path to a .sqlite opened automatically. Leave blank to always show the source picker.'
  };
});

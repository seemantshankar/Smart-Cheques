import fs from 'fs';

// Read the ESLint JSON output
const eslintOutput = JSON.parse(fs.readFileSync('./eslint-output.json', 'utf8'));

// Create a markdown string
let markdown = `# ESLint Errors and Warnings

This document lists all ESLint errors and warnings in the project.

`;

// Group by file
const fileErrors = {};

eslintOutput.forEach(result => {
  const filePath = result.filePath;
  const fileName = filePath.split('/').pop();
  
  if (!fileErrors[filePath]) {
    fileErrors[filePath] = [];
  }
  
  result.messages.forEach(message => {
    fileErrors[filePath].push({
      line: message.line,
      column: message.column,
      severity: message.severity === 1 ? 'Warning' : 'Error',
      message: message.message,
      ruleId: message.ruleId
    });
  });
});

// Generate markdown content
Object.keys(fileErrors).forEach(filePath => {
  const fileName = filePath.split('/').pop();
  markdown += `## ${fileName}

`;
  markdown += `| Line | Column | Severity | Rule | Message |
`;
  markdown += `|------|--------|----------|------|---------|
`;
  
  fileErrors[filePath].forEach(error => {
    markdown += `| ${error.line} | ${error.column} | ${error.severity} | ${error.ruleId || 'N/A'} | ${error.message.replace(/\|/g, '\\|')} |
`;
  });
  
  markdown += `
`;
});

// Write to the markdown file
fs.writeFileSync('./Docs/LinterErrors.md', markdown);

console.log('ESLint errors and warnings have been written to Docs/LinterErrors.md');
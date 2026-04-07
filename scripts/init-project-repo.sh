#!/bin/bash
# Initialize a git repository for a project folder
# Usage: ./scripts/init-project-repo.sh <project-name> [--github]

set -e

PROJECT_NAME="$1"
CREATE_GITHUB="$2"

if [ -z "$PROJECT_NAME" ]; then
    echo "Usage: $0 <project-name> [--github]"
    echo "Example: $0 chaos-injection --github"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$PROJECT_ROOT/projects/$PROJECT_NAME"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "Error: Project directory does not exist: $PROJECT_DIR"
    echo "Available projects:"
    ls -1 "$PROJECT_ROOT/projects/"
    exit 1
fi

if [ -d "$PROJECT_DIR/.git" ]; then
    echo "Git repo already exists in $PROJECT_DIR"
    exit 0
fi

echo "Initializing git repo for project: $PROJECT_NAME"
cd "$PROJECT_DIR"

# Initialize git
git init

# Create .gitignore
cat > .gitignore << 'EOF'
# OS
.DS_Store
Thumbs.db

# SQLite (graph is stored here - large binary)
store.db
store.db-journal
store.db-wal
store.db-shm

# Generated files that can be regenerated
*.aux
*.log
*.out
*.synctex.gz
*.fls
*.fdb_latexmk

# Keep generated/ folder but ignore intermediates
generated/*.aux
generated/*.log
generated/*.out
EOF

# Create README.md to tell AI about this repo
cat > README.md << EOF
# Project: $PROJECT_NAME

This is a **separate git repository** for the $PROJECT_NAME project.

## Important
- This folder has its own git history, separate from the main understanding-graph repo
- Commits here go to THIS repo, not the parent
- The graph database (store.db) is gitignored - it's stored locally only
- Generated files (PDFs, etc.) in \`generated/\` ARE tracked

## Working in this project
When making changes to files in this project:
1. Stage and commit to THIS repo
2. The parent understanding-graph repo ignores this folder entirely

## Structure
- \`store.db\` - SQLite graph database (local only)
- \`generated/\` - Output files (LaTeX, code, etc.)
- \`README.md\` - This file
EOF

# Initial commit
git add .
git commit -m "Initial commit for $PROJECT_NAME project"

echo ""
echo "✅ Git repo initialized for $PROJECT_NAME"
echo "   Location: $PROJECT_DIR"

# Optionally create GitHub repo
if [ "$CREATE_GITHUB" = "--github" ]; then
    echo ""
    echo "Creating GitHub repository..."
    gh repo create "$PROJECT_NAME" --private --source=. --push
    echo "✅ GitHub repo created and pushed"
fi

echo ""
echo "Next steps:"
echo "  cd $PROJECT_DIR"
echo "  git remote add origin <your-remote-url>  # if not using --github"
echo "  git push -u origin main"

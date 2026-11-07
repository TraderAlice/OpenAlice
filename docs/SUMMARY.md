# Guides

## Getting Started

* [What is OpenAlice](getting-started/what-is-openalice.md)
* [Quick Start](getting-started/quick-start.md)

## Installation & Deployment

* [Overview](getting-started/installation.md)
  * [macOS](getting-started/install-macos.md)
  * [Windows](getting-started/install-windows.md)
  * [Source & Dev](getting-started/developer-setup.md)
  * [CLI & Remote Access](deployment/remote-access.md)
  * [Remote Quickstart](remote-quickstart.md)
  * [AliceProjects](deployment/alice-projects.md)
  * [Data & Credentials](deployment/data-and-credentials.md)

## Workspaces & Activities

* [Workspaces](workspaces/workspaces.md)
* [AutoQuant](workspaces/autoquant.md)
* [Auto Prediction](workspaces/auto-prediction.md)
* [Workspace Manager](workspaces/manager.md)
* [Sessions & Collaboration](workspaces/sessions-and-collaboration.md)
* [Office · Beta](workspaces/office.md)
* [Issue Board](workspaces/issues.md)
* [Automation](workspaces/automation.md)
* [Webhook](workspaces/webhook.md)
* [Entities & Tracking](workspaces/entities.md)
* [Inbox](workspaces/inbox.md)

## Market Analysis

* [Data Hub](market-data/data-hub.md)
* [FX Workbench](market-data/fx-workbench.md)
* [Symbol Search](market-data/symbol-search.md)
* [Equity Research](market-data/equity-research.md)
* [Quant Calculator](market-data/technical-analysis.md)
* [Retrospective / Time Machine](market-data/retrospective.md)
* [Sector Rotation](market-data/sector-rotation.md)
* [News & RSS](market-data/news-and-rss.md)

## Trading (UTA)

* [Trading Setup](trading/accounts-and-brokers.md)
* [Broker Packs](trading/broker-packs.md)
* [Orders & Execution](trading/orders-and-execution.md)
* [Snapshots & Equity](trading/snapshots-and-equity.md)
* [Guards & Risk](trading/guards-and-risk.md)

## Configuration & Integrations

* [AI Providers](integration/ai-providers.md)
* [External Connectors](integration/external-connectors.md)
* [MCP Server](connectors/mcp-integration.md)
* [Configuration Reference](configuration/configuration-reference.md)

# Architecture

## Core Design

* [Trading as Collaboration](core-concepts/trading-as-collaboration.md)
* [Unified Trading Account](core-concepts/unified-trading-account.md)
* [Trading as Git](core-concepts/trading-as-git.md)
* [File-based State](core-concepts/file-based-state.md)

## Workspace Internals

* [Workspace Structure](workspaces/structure.md)
* [Lifecycle & Offboarding](workspaces/lifecycle.md)
* [Upgrades & Absorb](workspaces/upgrades-and-absorb.md)
* [CLI Injection](workspaces/cli-injection.md)
* [Settings Injection](workspaces/settings-injection.md)
* [Self-Describing Issues](workspaces/self-describing-issues.md)
* [Templates](workspaces/templates.md)

## Subsystem Contracts

* [Project Structure](architecture/project-structure.md)
* [AliceProject & Local Runtime](architecture/alice-project.md)
* [Workspace & Session Lifecycle](architecture/workspace-lifecycle.md)
* [Alice Harness & Runtime Injection](architecture/alice-harness.md)
* [Issues, Scheduling & Inbox](architecture/workspace-issues-and-scheduling.md)
* [Shell CLI Supervisor](architecture/cli-supervisor.md)
* [Remote Runtime & Access](architecture/remote-access.md)
* [CLI Installer & Updates](architecture/cli-installer.md)
* [Desktop Packaging & Managed Runtime](architecture/managed-workspace-runtime.md)
* [UTA, Broker Packs & IBKR](architecture/uta-live-testing.md)
* [Market Data Architecture](architecture/market-data-architecture.md)
* [Connector Service](architecture/connector-service.md)
* [UI Interaction & Motion](architecture/ui-interaction-and-motion.md)

## Extending & Engineering

* [Custom Brokers](extending/custom-brokers.md)
* [Custom Guards](extending/custom-guards.md)
* [Custom Tools](extending/custom-tools.md)
* [Development Workflow](architecture/development-workflow.md)
* [Testing & Verification](architecture/testing.md)

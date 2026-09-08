#!/bin/bash

################################################################################
# FILARR QA TEST SUITE - AUTOMATION SCRIPT
################################################################################
# Description: Script d'execution automatisee de la suite de tests QA complete
# Version: 1.0.0
# Date: 2025-11-21
# Author: QA Team
################################################################################

set -e  # Exit on error
set -o pipefail  # Exit on pipe failure

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REPORT_DIR="$PROJECT_ROOT/qa-reports/$TIMESTAMP"
LOG_FILE="$REPORT_DIR/qa-suite.log"

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

################################################################################
# FUNCTIONS
################################################################################

# Print header
print_header() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║               FILARR QA TEST SUITE v1.0.0                        ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print section header
print_section() {
    echo -e "\n${YELLOW}▶ $1${NC}\n"
}

# Print success message
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Print error message
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Print warning message
print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Print info message
print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Setup report directory
setup_reports() {
    print_section "Setting up report directory"
    mkdir -p "$REPORT_DIR"
    echo "Report directory: $REPORT_DIR" > "$LOG_FILE"
    print_success "Report directory created: $REPORT_DIR"
}

# Check prerequisites
check_prerequisites() {
    print_section "Checking prerequisites"

    local all_ok=true

    # Check Node.js
    if command -v node &> /dev/null; then
        local node_version=$(node --version)
        print_success "Node.js installed: $node_version"
    else
        print_error "Node.js not found. Please install Node.js 18+"
        all_ok=false
    fi

    # Check npm
    if command -v npm &> /dev/null; then
        local npm_version=$(npm --version)
        print_success "npm installed: $npm_version"
    else
        print_error "npm not found. Please install npm"
        all_ok=false
    fi

    # Check if dependencies are installed
    if [ -d "$PROJECT_ROOT/node_modules" ]; then
        print_success "node_modules found"
    else
        print_warning "node_modules not found. Running npm install..."
        cd "$PROJECT_ROOT"
        npm install
    fi

    if [ "$all_ok" = false ]; then
        print_error "Prerequisites check failed. Exiting."
        exit 1
    fi

    print_success "All prerequisites met"
}

# Run unit tests
run_unit_tests() {
    print_section "Running Unit Tests"

    cd "$PROJECT_ROOT"

    if npm test -- --coverage --watchAll=false > "$REPORT_DIR/unit-tests.log" 2>&1; then
        print_success "Unit tests passed"

        # Extract test results
        if [ -f "coverage/coverage-summary.json" ]; then
            cp coverage/coverage-summary.json "$REPORT_DIR/"
        fi

        return 0
    else
        print_error "Unit tests failed"
        print_info "See log: $REPORT_DIR/unit-tests.log"
        return 1
    fi
}

# Run integration tests
run_integration_tests() {
    print_section "Running Integration Tests"

    cd "$PROJECT_ROOT"

    # Check if integration tests exist
    if [ ! -d "src/__tests__/integration" ]; then
        print_warning "No integration tests found. Skipping."
        return 0
    fi

    if npm run test:integration > "$REPORT_DIR/integration-tests.log" 2>&1; then
        print_success "Integration tests passed"
        return 0
    else
        print_error "Integration tests failed"
        print_info "See log: $REPORT_DIR/integration-tests.log"
        return 1
    fi
}

# Run E2E tests
run_e2e_tests() {
    print_section "Running E2E Tests (Playwright)"

    cd "$PROJECT_ROOT"

    # Check if playwright is installed
    if ! command -v playwright &> /dev/null; then
        print_warning "Playwright not found. Installing..."
        npx playwright install
    fi

    # Start the app in test mode (background)
    print_info "Starting application in test mode..."
    npm run start > "$REPORT_DIR/app-server.log" 2>&1 &
    APP_PID=$!

    # Wait for app to be ready
    print_info "Waiting for application to be ready (max 60s)..."
    local max_wait=60
    local wait_count=0
    while ! curl -s http://localhost:3000 > /dev/null; do
        sleep 1
        wait_count=$((wait_count + 1))
        if [ $wait_count -gt $max_wait ]; then
            print_error "Application failed to start within ${max_wait}s"
            kill $APP_PID 2>/dev/null || true
            return 1
        fi
    done
    print_success "Application ready"

    # Run E2E tests
    if npm run test:e2e > "$REPORT_DIR/e2e-tests.log" 2>&1; then
        print_success "E2E tests passed"

        # Copy Playwright report
        if [ -d "test-results" ]; then
            cp -r test-results "$REPORT_DIR/"
        fi

        local result=0
    else
        print_error "E2E tests failed"
        print_info "See log: $REPORT_DIR/e2e-tests.log"
        local result=1
    fi

    # Stop the app
    print_info "Stopping application..."
    kill $APP_PID 2>/dev/null || true

    return $result
}

# Run performance tests
run_performance_tests() {
    print_section "Running Performance Tests"

    cd "$PROJECT_ROOT"

    # Check if k6 is installed
    if ! command -v k6 &> /dev/null; then
        print_warning "k6 not found. Skipping performance tests."
        print_info "Install k6: https://k6.io/docs/getting-started/installation/"
        return 0
    fi

    # Check if performance tests exist
    if [ ! -d "performance-tests" ]; then
        print_warning "No performance tests found. Skipping."
        return 0
    fi

    print_info "Running load tests with k6..."
    k6 run performance-tests/load-test.js > "$REPORT_DIR/performance-tests.log" 2>&1 || {
        print_error "Performance tests failed"
        return 1
    }

    print_success "Performance tests passed"
    return 0
}

# Run security tests
run_security_tests() {
    print_section "Running Security Tests"

    cd "$PROJECT_ROOT"

    print_info "Running npm audit..."
    npm audit --json > "$REPORT_DIR/npm-audit.json" 2>&1 || {
        print_warning "npm audit found vulnerabilities"
    }

    # Check for critical/high vulnerabilities
    local critical=$(cat "$REPORT_DIR/npm-audit.json" | grep -o '"critical":[0-9]*' | cut -d':' -f2 || echo "0")
    local high=$(cat "$REPORT_DIR/npm-audit.json" | grep -o '"high":[0-9]*' | cut -d':' -f2 || echo "0")

    if [ "$critical" -gt 0 ] || [ "$high" -gt 0 ]; then
        print_error "Found $critical critical and $high high vulnerabilities"
        print_info "Run 'npm audit fix' to fix vulnerabilities"
        return 1
    else
        print_success "No critical/high vulnerabilities found"
        return 0
    fi
}

# Run linting
run_linting() {
    print_section "Running Code Linting"

    cd "$PROJECT_ROOT"

    # ESLint
    if [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ]; then
        print_info "Running ESLint..."
        if npx eslint src/ --format json > "$REPORT_DIR/eslint-report.json" 2>&1; then
            print_success "ESLint passed"
        else
            print_error "ESLint found issues"
            print_info "See report: $REPORT_DIR/eslint-report.json"
            return 1
        fi
    else
        print_warning "ESLint config not found. Skipping."
    fi

    return 0
}

# Generate coverage report
generate_coverage_report() {
    print_section "Generating Coverage Report"

    cd "$PROJECT_ROOT"

    if [ -d "coverage" ]; then
        # Copy coverage reports
        cp -r coverage "$REPORT_DIR/"

        # Extract coverage summary
        if [ -f "coverage/coverage-summary.json" ]; then
            local lines=$(cat coverage/coverage-summary.json | grep -o '"lines":{"total":[0-9]*,"covered":[0-9]*' | head -1)
            local total=$(echo $lines | grep -o 'total":[0-9]*' | cut -d':' -f2)
            local covered=$(echo $lines | grep -o 'covered":[0-9]*' | cut -d':' -f2)

            if [ "$total" -gt 0 ]; then
                local percentage=$((covered * 100 / total))
                print_success "Code coverage: ${percentage}% ($covered/$total lines)"

                if [ "$percentage" -ge 80 ]; then
                    print_success "Coverage target met (≥80%)"
                else
                    print_warning "Coverage below target: ${percentage}% < 80%"
                fi
            fi
        fi
    else
        print_warning "No coverage data found"
    fi
}

# Generate final report
generate_final_report() {
    print_section "Generating Final Report"

    local report_file="$REPORT_DIR/QA_REPORT.md"

    cat > "$report_file" <<EOF
# QA Test Suite Report

**Generated**: $(date)
**Project**: Filarr v1.3.0
**Branch**: $(git branch --show-current 2>/dev/null || echo "unknown")
**Commit**: $(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

---

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | $TOTAL_TESTS |
| Passed | $PASSED_TESTS |
| Failed | $FAILED_TESTS |
| Skipped | $SKIPPED_TESTS |
| Success Rate | $([ $TOTAL_TESTS -gt 0 ] && echo "scale=2; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc || echo "0")% |

---

## Test Results

### Unit Tests
$([ -f "$REPORT_DIR/unit-tests.log" ] && echo "✅ Completed - See unit-tests.log" || echo "⏭️ Skipped")

### Integration Tests
$([ -f "$REPORT_DIR/integration-tests.log" ] && echo "✅ Completed - See integration-tests.log" || echo "⏭️ Skipped")

### E2E Tests
$([ -f "$REPORT_DIR/e2e-tests.log" ] && echo "✅ Completed - See e2e-tests.log" || echo "⏭️ Skipped")

### Performance Tests
$([ -f "$REPORT_DIR/performance-tests.log" ] && echo "✅ Completed - See performance-tests.log" || echo "⏭️ Skipped")

### Security Tests
$([ -f "$REPORT_DIR/npm-audit.json" ] && echo "✅ Completed - See npm-audit.json" || echo "⏭️ Skipped")

### Linting
$([ -f "$REPORT_DIR/eslint-report.json" ] && echo "✅ Completed - See eslint-report.json" || echo "⏭️ Skipped")

---

## Coverage

$([ -f "$REPORT_DIR/coverage-summary.json" ] && echo "See coverage/ directory for detailed coverage report" || echo "No coverage data available")

---

## Files

- Full logs: qa-suite.log
- Unit tests: unit-tests.log
- Integration tests: integration-tests.log
- E2E tests: e2e-tests.log
- Performance tests: performance-tests.log
- Security audit: npm-audit.json
- Linting report: eslint-report.json
- Coverage: coverage/

---

**Report Location**: $REPORT_DIR
EOF

    print_success "Final report generated: $report_file"

    # Display the report
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    cat "$report_file"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

# Cleanup
cleanup() {
    print_info "Cleaning up..."

    # Kill any remaining processes
    pkill -f "react-scripts start" 2>/dev/null || true
    pkill -f "electron" 2>/dev/null || true

    print_success "Cleanup complete"
}

################################################################################
# MAIN EXECUTION
################################################################################

main() {
    print_header

    # Trap cleanup on exit
    trap cleanup EXIT

    # Setup
    setup_reports
    check_prerequisites

    # Track overall success
    local overall_success=true

    # Run test suites
    echo "" >> "$LOG_FILE"
    echo "═══════════════════════════════════════" >> "$LOG_FILE"
    echo "Starting test execution..." >> "$LOG_FILE"
    echo "═══════════════════════════════════════" >> "$LOG_FILE"

    # Linting (non-blocking)
    run_linting || print_warning "Linting failed but continuing..."

    # Unit Tests
    if run_unit_tests; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        overall_success=false
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Integration Tests
    if run_integration_tests; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        overall_success=false
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # E2E Tests
    if run_e2e_tests; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        overall_success=false
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Performance Tests (optional)
    run_performance_tests || SKIPPED_TESTS=$((SKIPPED_TESTS + 1))

    # Security Tests
    if run_security_tests; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        overall_success=false
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Generate reports
    generate_coverage_report
    generate_final_report

    # Final summary
    print_section "Test Suite Complete"

    if [ "$overall_success" = true ]; then
        print_success "ALL TESTS PASSED ✨"
        echo -e "${GREEN}"
        echo "╔════════════════════════════════════════╗"
        echo "║       QA SUITE: ALL TESTS PASSED       ║"
        echo "╚════════════════════════════════════════╝"
        echo -e "${NC}"
        exit 0
    else
        print_error "SOME TESTS FAILED"
        echo -e "${RED}"
        echo "╔════════════════════════════════════════╗"
        echo "║       QA SUITE: TESTS FAILED           ║"
        echo "╚════════════════════════════════════════╝"
        echo -e "${NC}"
        print_info "Check reports in: $REPORT_DIR"
        exit 1
    fi
}

# Parse command line arguments
case "${1:-}" in
    --help|-h)
        print_header
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h          Show this help message"
        echo "  --unit              Run only unit tests"
        echo "  --integration       Run only integration tests"
        echo "  --e2e               Run only E2E tests"
        echo "  --performance       Run only performance tests"
        echo "  --security          Run only security tests"
        echo "  --all               Run all tests (default)"
        echo ""
        echo "Examples:"
        echo "  $0                  # Run all tests"
        echo "  $0 --unit           # Run only unit tests"
        echo "  $0 --e2e            # Run only E2E tests"
        echo ""
        exit 0
        ;;
    --unit)
        print_header
        setup_reports
        check_prerequisites
        run_unit_tests
        exit $?
        ;;
    --integration)
        print_header
        setup_reports
        check_prerequisites
        run_integration_tests
        exit $?
        ;;
    --e2e)
        print_header
        setup_reports
        check_prerequisites
        run_e2e_tests
        exit $?
        ;;
    --performance)
        print_header
        setup_reports
        check_prerequisites
        run_performance_tests
        exit $?
        ;;
    --security)
        print_header
        setup_reports
        check_prerequisites
        run_security_tests
        exit $?
        ;;
    --all|"")
        main
        ;;
    *)
        print_error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac

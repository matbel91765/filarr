#!/bin/bash

# ===============================================
# Filarr - S3 Storage Setup Script
# ===============================================
#
# This script helps you set up S3 storage for Filarr.
# It supports:
# - AWS S3
# - MinIO (self-hosted)
# - DigitalOcean Spaces
# - Backblaze B2
# - Wasabi
#
# Usage:
#   ./scripts/setup-s3.sh [--provider aws|minio|digitalocean|backblaze|wasabi]
#
# ===============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Emoji support
CHECK="✅"
CROSS="❌"
WARN="⚠️"
INFO="ℹ️"
ROCKET="🚀"

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              Filarr - S3 Storage Setup                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Parse command line arguments
PROVIDER=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --provider)
      PROVIDER="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}${CROSS} Unknown argument: $1${NC}"
      exit 1
      ;;
  esac
done

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to validate AWS credentials
validate_aws_credentials() {
  echo -e "\n${BLUE}${INFO} Validating AWS credentials...${NC}"

  if ! command_exists aws; then
    echo -e "${RED}${CROSS} AWS CLI not found. Please install it:${NC}"
    echo "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    return 1
  fi

  if aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${GREEN}${CHECK} AWS credentials are valid${NC}"
    aws sts get-caller-identity --query 'Account' --output text | xargs echo "  AWS Account:"
    return 0
  else
    echo -e "${RED}${CROSS} AWS credentials are invalid or not configured${NC}"
    echo "  Run: aws configure"
    return 1
  fi
}

# Function to check if S3 bucket exists
check_s3_bucket() {
  local bucket=$1
  echo -e "\n${BLUE}${INFO} Checking if bucket '${bucket}' exists...${NC}"

  if aws s3 ls "s3://${bucket}" >/dev/null 2>&1; then
    echo -e "${GREEN}${CHECK} Bucket '${bucket}' exists${NC}"
    return 0
  else
    echo -e "${YELLOW}${WARN} Bucket '${bucket}' does not exist${NC}"
    return 1
  fi
}

# Function to create S3 bucket
create_s3_bucket() {
  local bucket=$1
  local region=$2

  echo -e "\n${BLUE}${INFO} Creating S3 bucket '${bucket}' in region '${region}'...${NC}"

  if [ "$region" == "us-east-1" ]; then
    # us-east-1 doesn't need LocationConstraint
    aws s3 mb "s3://${bucket}" --region "$region"
  else
    aws s3 mb "s3://${bucket}" --region "$region" --create-bucket-configuration LocationConstraint="$region"
  fi

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}${CHECK} Bucket '${bucket}' created successfully${NC}"
    return 0
  else
    echo -e "${RED}${CROSS} Failed to create bucket '${bucket}'${NC}"
    return 1
  fi
}

# Function to configure bucket versioning
enable_bucket_versioning() {
  local bucket=$1
  echo -e "\n${BLUE}${INFO} Enabling versioning for bucket '${bucket}'...${NC}"

  aws s3api put-bucket-versioning \
    --bucket "$bucket" \
    --versioning-configuration Status=Enabled

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}${CHECK} Versioning enabled${NC}"
  else
    echo -e "${YELLOW}${WARN} Failed to enable versioning${NC}"
  fi
}

# Function to configure bucket encryption
enable_bucket_encryption() {
  local bucket=$1
  echo -e "\n${BLUE}${INFO} Enabling encryption for bucket '${bucket}'...${NC}"

  aws s3api put-bucket-encryption \
    --bucket "$bucket" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        },
        "BucketKeyEnabled": true
      }]
    }'

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}${CHECK} Encryption enabled (AES256)${NC}"
  else
    echo -e "${YELLOW}${WARN} Failed to enable encryption${NC}"
  fi
}

# Function to configure bucket lifecycle
configure_bucket_lifecycle() {
  local bucket=$1
  echo -e "\n${BLUE}${INFO} Configuring lifecycle policy for bucket '${bucket}'...${NC}"

  cat > /tmp/lifecycle-policy.json <<EOF
{
  "Rules": [
    {
      "Id": "DeleteIncompleteMultipartUploads",
      "Status": "Enabled",
      "Prefix": "",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "Id": "ArchiveOldVersions",
      "Status": "Enabled",
      "Prefix": "",
      "NoncurrentVersionTransitions": [
        {
          "NoncurrentDays": 90,
          "StorageClass": "GLACIER"
        }
      ],
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 365
      }
    }
  ]
}
EOF

  aws s3api put-bucket-lifecycle-configuration \
    --bucket "$bucket" \
    --lifecycle-configuration file:///tmp/lifecycle-policy.json

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}${CHECK} Lifecycle policy configured${NC}"
    rm /tmp/lifecycle-policy.json
  else
    echo -e "${YELLOW}${WARN} Failed to configure lifecycle policy${NC}"
  fi
}

# Function to configure CORS
configure_bucket_cors() {
  local bucket=$1
  echo -e "\n${BLUE}${INFO} Configuring CORS for bucket '${bucket}'...${NC}"

  cat > /tmp/cors-policy.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["http://localhost:3000", "https://filarr.com"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Length"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

  aws s3api put-bucket-cors \
    --bucket "$bucket" \
    --cors-configuration file:///tmp/cors-policy.json

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}${CHECK} CORS configured${NC}"
    rm /tmp/cors-policy.json
  else
    echo -e "${YELLOW}${WARN} Failed to configure CORS${NC}"
  fi
}

# Function to test S3 connection
test_s3_connection() {
  local bucket=$1
  echo -e "\n${BLUE}${INFO} Testing S3 connection...${NC}"

  # Create test file
  echo "Filarr S3 Test" > /tmp/filarr-test.txt

  # Upload test file
  echo "  Uploading test file..."
  aws s3 cp /tmp/filarr-test.txt "s3://${bucket}/test/filarr-test.txt" >/dev/null 2>&1

  if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to upload test file${NC}"
    return 1
  fi

  # Download test file
  echo "  Downloading test file..."
  aws s3 cp "s3://${bucket}/test/filarr-test.txt" /tmp/filarr-test-download.txt >/dev/null 2>&1

  if [ $? -ne 0 ]; then
    echo -e "${RED}${CROSS} Failed to download test file${NC}"
    return 1
  fi

  # Verify content
  if diff /tmp/filarr-test.txt /tmp/filarr-test-download.txt >/dev/null 2>&1; then
    echo -e "${GREEN}${CHECK} Upload/Download test successful${NC}"
  else
    echo -e "${RED}${CROSS} Downloaded file content mismatch${NC}"
    return 1
  fi

  # Delete test file
  echo "  Cleaning up test files..."
  aws s3 rm "s3://${bucket}/test/filarr-test.txt" >/dev/null 2>&1
  rm /tmp/filarr-test.txt /tmp/filarr-test-download.txt

  echo -e "${GREEN}${CHECK} S3 connection test passed${NC}"
  return 0
}

# Function to setup MinIO locally
setup_minio() {
  echo -e "\n${BLUE}${INFO} Setting up MinIO locally...${NC}"

  if ! command_exists docker; then
    echo -e "${RED}${CROSS} Docker not found. Please install Docker first.${NC}"
    return 1
  fi

  # Check if MinIO container is already running
  if docker ps | grep -q filarr-minio; then
    echo -e "${YELLOW}${WARN} MinIO container already running${NC}"
    echo "  Container name: filarr-minio"
    echo "  Console: http://localhost:9001"
    echo "  API: http://localhost:9000"
    return 0
  fi

  echo "  Starting MinIO container..."
  docker run -d \
    --name filarr-minio \
    -p 9000:9000 \
    -p 9001:9001 \
    -e "MINIO_ROOT_USER=minioadmin" \
    -e "MINIO_ROOT_PASSWORD=minioadmin123" \
    -v filarr_minio_data:/data \
    minio/minio server /data --console-address ":9001"

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}${CHECK} MinIO container started${NC}"
    echo "  Container name: filarr-minio"
    echo "  Console: http://localhost:9001"
    echo "  API: http://localhost:9000"
    echo "  Username: minioadmin"
    echo "  Password: minioadmin123"

    # Wait for MinIO to be ready
    echo -e "\n  Waiting for MinIO to be ready..."
    sleep 5

    # Create bucket using mc (MinIO Client)
    if command_exists mc; then
      echo "  Creating bucket 'filarr-files'..."
      mc alias set local http://localhost:9000 minioadmin minioadmin123 >/dev/null 2>&1
      mc mb local/filarr-files >/dev/null 2>&1
      echo -e "${GREEN}${CHECK} Bucket 'filarr-files' created${NC}"
    else
      echo -e "${YELLOW}${WARN} MinIO Client (mc) not found. Please create bucket manually.${NC}"
      echo "  Visit: http://localhost:9001"
    fi

    return 0
  else
    echo -e "${RED}${CROSS} Failed to start MinIO container${NC}"
    return 1
  fi
}

# Function to display summary
display_summary() {
  local provider=$1
  local bucket=$2
  local region=$3
  local endpoint=$4

  echo -e "\n${GREEN}"
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║                  Setup Complete!                           ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  echo -e "${BLUE}${ROCKET} S3 Storage Configuration:${NC}"
  echo "  Provider: $provider"
  echo "  Bucket: $bucket"
  echo "  Region: $region"
  [ -n "$endpoint" ] && echo "  Endpoint: $endpoint"

  echo -e "\n${BLUE}${INFO} Environment Variables:${NC}"
  echo "  Add these to your .env file:"
  echo ""
  echo "  USE_S3=true"
  [ -n "$endpoint" ] && echo "  S3_ENDPOINT=$endpoint"
  echo "  S3_BUCKET=$bucket"
  echo "  AWS_REGION=$region"

  if [ "$provider" == "minio" ]; then
    echo "  AWS_ACCESS_KEY_ID=minioadmin"
    echo "  AWS_SECRET_ACCESS_KEY=minioadmin123"
  else
    echo "  AWS_ACCESS_KEY_ID=<your-access-key>"
    echo "  AWS_SECRET_ACCESS_KEY=<your-secret-key>"
  fi

  echo -e "\n${BLUE}${INFO} Next Steps:${NC}"
  echo "  1. Configure BYOS provider in Filarr Settings > Storage"
  echo "  2. Restart your application"
  echo "  3. Test file upload/download"

  echo -e "\n${GREEN}${CHECK} All done! Your S3 storage is ready.${NC}\n"
}

# Main setup flow
main() {
  # If no provider specified, show menu
  if [ -z "$PROVIDER" ]; then
    echo "Select your S3 storage provider:"
    echo "  1) AWS S3"
    echo "  2) MinIO (local)"
    echo "  3) DigitalOcean Spaces"
    echo "  4) Backblaze B2"
    echo "  5) Wasabi"
    echo ""
    read -p "Enter choice (1-5): " choice

    case $choice in
      1) PROVIDER="aws" ;;
      2) PROVIDER="minio" ;;
      3) PROVIDER="digitalocean" ;;
      4) PROVIDER="backblaze" ;;
      5) PROVIDER="wasabi" ;;
      *)
        echo -e "${RED}${CROSS} Invalid choice${NC}"
        exit 1
        ;;
    esac
  fi

  case $PROVIDER in
    aws)
      echo -e "\n${BLUE}${ROCKET} Setting up AWS S3...${NC}"

      # Validate credentials
      if ! validate_aws_credentials; then
        echo -e "${RED}${CROSS} Setup failed. Please configure AWS credentials.${NC}"
        exit 1
      fi

      # Get bucket name and region
      read -p "Enter S3 bucket name (e.g., filarr-production): " BUCKET_NAME
      read -p "Enter AWS region (e.g., eu-west-1): " AWS_REGION

      # Check if bucket exists
      if ! check_s3_bucket "$BUCKET_NAME"; then
        read -p "Create bucket? (y/n): " CREATE_BUCKET
        if [ "$CREATE_BUCKET" == "y" ]; then
          if ! create_s3_bucket "$BUCKET_NAME" "$AWS_REGION"; then
            exit 1
          fi
        else
          echo -e "${RED}${CROSS} Setup cancelled${NC}"
          exit 1
        fi
      fi

      # Configure bucket
      enable_bucket_versioning "$BUCKET_NAME"
      enable_bucket_encryption "$BUCKET_NAME"
      configure_bucket_lifecycle "$BUCKET_NAME"
      configure_bucket_cors "$BUCKET_NAME"

      # Test connection
      if ! test_s3_connection "$BUCKET_NAME"; then
        echo -e "${RED}${CROSS} Connection test failed${NC}"
        exit 1
      fi

      display_summary "AWS S3" "$BUCKET_NAME" "$AWS_REGION" ""
      ;;

    minio)
      echo -e "\n${BLUE}${ROCKET} Setting up MinIO...${NC}"

      if ! setup_minio; then
        exit 1
      fi

      display_summary "MinIO" "filarr-files" "us-east-1" "http://localhost:9000"
      ;;

    digitalocean)
      echo -e "\n${BLUE}${ROCKET} Setting up DigitalOcean Spaces...${NC}"
      echo -e "${YELLOW}${INFO} Manual setup required${NC}"
      echo ""
      echo "Steps:"
      echo "1. Go to: https://cloud.digitalocean.com/spaces"
      echo "2. Create a new Space"
      echo "3. Generate Spaces access keys"
      echo "4. Copy example configuration from .env.s3.example"
      echo ""
      ;;

    backblaze)
      echo -e "\n${BLUE}${ROCKET} Setting up Backblaze B2...${NC}"
      echo -e "${YELLOW}${INFO} Manual setup required${NC}"
      echo ""
      echo "Steps:"
      echo "1. Go to: https://www.backblaze.com/b2/"
      echo "2. Create a bucket"
      echo "3. Create an application key"
      echo "4. Copy example configuration from .env.s3.example"
      echo ""
      ;;

    wasabi)
      echo -e "\n${BLUE}${ROCKET} Setting up Wasabi...${NC}"
      echo -e "${YELLOW}${INFO} Manual setup required${NC}"
      echo ""
      echo "Steps:"
      echo "1. Go to: https://wasabi.com/"
      echo "2. Create a bucket"
      echo "3. Get access keys"
      echo "4. Copy example configuration from .env.s3.example"
      echo ""
      ;;

    *)
      echo -e "${RED}${CROSS} Unknown provider: $PROVIDER${NC}"
      exit 1
      ;;
  esac
}

# Run main function
main

#!/usr/bin/env bash
set -euo pipefail

awslocal s3api create-bucket \
--bucket zero-vault \
--create-bucket-configuration LocationConstraint=eu-central-1 || true

awslocal s3api put-bucket-cors \
--bucket zero-vault \
--cors-configuration file:///etc/localstack/init/ready.d/cors.json
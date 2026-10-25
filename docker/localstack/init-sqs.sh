#!/bin/sh
set -eu

awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}'

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

cat > /tmp/redrive.json << EOF
{"deadLetterTargetArn":"${DLQ_ARN}","maxReceiveCount":"${SQS_MAX_RECEIVE_COUNT:-5}"}
EOF

REDRIVE_POLICY=$(cat /tmp/redrive.json | tr -d '\n')

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"VisibilityTimeout\":\"${SQS_VISIBILITY_TIMEOUT_SECONDS:-60}\",\"RedrivePolicy\":\"$(echo "$REDRIVE_POLICY" | sed 's/"/\\"/g')\"}"

awslocal sqs create-queue \
  --queue-name wager-events.fifo \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}'

echo "SQS queues ready"
exit 0

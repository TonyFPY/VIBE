import boto3
bedrock = boto3.client("bedrock", region_name="us-east-1")
r = bedrock.list_foundation_models(byProvider="Google")
for m in r["modelSummaries"]:
  print(m["modelId"])
#!/bin/bash

#Sean Begley
#2017-07-06

#Bash Script to download all Assets from a quakejs content server.
#The default server is http://content.quakejs.com

#OPTIONAL first parameters ($1) = address of alternate quakejs content server

#EXAMPLE USAGE
#./get_assets.sh
#./get_assets.sh /alternate/output/folder
#./get_assets.sh /alternate/output/folder http://alternate.content.server.com

#Setup output folder
#Default to "."
#If the user enters parameters then the 1st parameter is the desired output directory
output_dir=.
if [ ! -z "$1" ]; then
	output_dir=$1
fi

#Setup the content server address
#Default to http://content.quakejs.com
#If the user enters paremters then the 2nd parameter is the desired content server
server="http://content.quakejs.com"
if [ ! -z "$2" ]; then
	server=$2
fi
printf "Using content server: $server\n"

#Download manifest.json and get the # of assets available
printf "Downloading manifest.json\n"
mkdir -p "$output_dir/assets"
wget --quiet --show-progress --continue --no-clobber -O "$output_dir/assets/manifest.json" "$server/assets/manifest.json"
num_elems=$(jq '. | length' "$output_dir/assets/manifest.json")
#manifest="$(wget --quiet --show-progress --continue --no-clobber -O $server/assets/manifest.json)"
#num_elems=$(echo "$manifest" | jq '. | length')
printf "$num_elems assets found in manifest.json\n"

#loop through the manifest and download each file
#name contains the path/filename
#checksum contains the checksum value
#the file has to be downloaded from "path/checksum-filename"
for i in $( eval echo {1..$num_elems} )
do
	let "j = $i - 1"
	name=$(jq -r '.['$j'].name' "$output_dir/assets/manifest.json")
	IFS='/' name_tokens=( $name )
	if [ ${#name_tokens[@]} -eq "1" ]; then
		filename=$(jq -r '.['$j'].checksum' "$output_dir/assets/manifest.json")'-'${name_tokens[0]}
		download_path='assets'
	else
		filename=$(jq -r '.['$j'].checksum' "$output_dir/assets/manifest.json")'-'${name_tokens[1]}
		download_path='assets/'${name_tokens[0]}
	fi
	printf "Downloading $name to $output_dir/$download_path/$filename\n"
	
	#if output path doesn't exist, make it
	if [ ! -d "$output_dir/$download_path" ]; then
		mkdir "$output_dir/$download_path"
	fi
	
	#download file
	wget --quiet --show-progress --continue --no-clobber -O "$output_dir/$download_path/$filename" "$server/$download_path/$filename"	
done
